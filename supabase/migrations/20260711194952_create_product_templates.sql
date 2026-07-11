-- ============================================================
-- Product Templates (Phase 2, Item 19)
-- Two tables + updated_at trigger + cross-table validation
-- triggers + RLS + one seed row. Additive; no existing table or
-- data is touched. Mirrors the is_admin() write / public-read
-- pattern used by designer_pricing.
-- ============================================================

-- Auto-stamp updated_at on UPDATE. No such helper existed before;
-- reusable later (e.g. to fix designer_pricing's stale updated_at).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---- product_templates -------------------------------------
create table public.product_templates (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null,
  shopify_product_id      text not null unique,
  supported_print_methods text[] not null,
  default_print_method    text not null
                            references public.designer_print_methods(key)
                            on update cascade on delete restrict,
  is_active               boolean not null default true,
  sort_order              integer not null default 0,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint product_templates_supported_nonempty
    check (array_length(supported_print_methods, 1) >= 1),
  constraint product_templates_default_in_supported
    check (default_print_method = any (supported_print_methods))
);

create index idx_product_templates_active_sort
  on public.product_templates (is_active, sort_order);

create trigger trg_product_templates_updated_at
  before update on public.product_templates
  for each row execute function public.set_updated_at();

-- ---- product_template_print_areas --------------------------
create table public.product_template_print_areas (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null
                 references public.product_templates(id) on delete cascade,
  name         text not null,
  side         text not null,          -- 'front' | 'back' by convention; left open
  print_method text not null
                 references public.designer_print_methods(key)
                 on update cascade on delete restrict,
  x_px         integer not null check (x_px >= 0),
  y_px         integer not null check (y_px >= 0),
  width_px     integer not null check (width_px  > 0),
  height_px    integer not null check (height_px > 0),
  width_in     numeric(6,3) not null check (width_in  > 0),
  height_in    numeric(6,3) not null check (height_in > 0),
  preset_label text,
  sort_order   integer not null default 0,
  constraint print_areas_side_nonempty check (length(trim(side)) > 0),
  constraint print_areas_unique_name_per_template unique (template_id, name)
);

create index idx_print_areas_template
  on public.product_template_print_areas (template_id, sort_order);

-- ---- Cross-table integrity triggers ------------------------
-- (no CHECK/FK can express these)

-- Every supported method must be a real designer_print_methods.key, and on
-- UPDATE you can't drop a method that an existing print area still uses.
create or replace function public.validate_template_print_methods()
returns trigger
language plpgsql
as $$
declare
  m text;
  bad text;
begin
  foreach m in array new.supported_print_methods loop
    if not exists (select 1 from public.designer_print_methods p where p.key = m) then
      raise exception 'supported_print_methods contains unknown method key: %', m;
    end if;
  end loop;

  if tg_op = 'UPDATE' then
    select pa.print_method into bad
    from public.product_template_print_areas pa
    where pa.template_id = new.id
      and not (pa.print_method = any (new.supported_print_methods))
    limit 1;
    if bad is not null then
      raise exception 'cannot remove method %: a print area on this template still uses it', bad;
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_validate_template_print_methods
  before insert or update on public.product_templates
  for each row execute function public.validate_template_print_methods();

-- A print area's method must be in its template's supported list.
create or replace function public.validate_print_area_method()
returns trigger
language plpgsql
as $$
declare
  supported text[];
begin
  select t.supported_print_methods into supported
  from public.product_templates t where t.id = new.template_id;

  if supported is null then
    raise exception 'template % not found', new.template_id;
  end if;

  if not (new.print_method = any (supported)) then
    raise exception 'print_method % is not in the template''s supported_print_methods %',
      new.print_method, supported;
  end if;

  return new;
end;
$$;

create trigger trg_validate_print_area_method
  before insert or update on public.product_template_print_areas
  for each row execute function public.validate_print_area_method();

-- ---- RLS ---------------------------------------------------
alter table public.product_templates            enable row level security;
alter table public.product_template_print_areas enable row level security;

create policy "product_templates_public_read"
  on public.product_templates
  for select to anon, authenticated
  using (is_active = true);

create policy "product_templates_admin_all"
  on public.product_templates
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "product_template_print_areas_public_read"
  on public.product_template_print_areas
  for select to anon, authenticated
  using (exists (
    select 1 from public.product_templates t
    where t.id = template_id and t.is_active = true
  ));

create policy "product_template_print_areas_admin_all"
  on public.product_template_print_areas
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---- Seed (template row only; print areas deferred to Day 7) ----
-- GID form matches how the designer holds product.id and how
-- design_orders.shopify_product_id is already stored.
insert into public.product_templates
  (name, shopify_product_id, supported_print_methods, default_print_method)
values
  ('100% Cotton T-Shirt', 'gid://shopify/Product/10042340507964',
   array['screen_print'], 'screen_print');
