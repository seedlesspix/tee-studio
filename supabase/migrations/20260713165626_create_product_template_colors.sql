-- Phase 3 Day 6: per-template garment color assignments. Each product template
-- assigns its Shopify colors a required hex (print-shop capture + fallback
-- swatch) and an optional swatch image URL (heathered / two-tone garments).
-- Public read for active templates; admin-only writes. Additive, reversible.
create table public.product_template_colors (
  id                uuid primary key default gen_random_uuid(),
  template_id       uuid not null references public.product_templates(id) on delete cascade,
  color_name        text not null,
  hex               text not null,
  swatch_image_url  text,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  constraint product_template_colors_unique_name unique (template_id, color_name)
);

create index idx_product_template_colors_template
  on public.product_template_colors (template_id, sort_order);

alter table public.product_template_colors enable row level security;

create policy "product_template_colors_public_read"
  on public.product_template_colors
  for select to anon, authenticated
  using (exists (select 1 from public.product_templates t
                 where t.id = template_id and t.is_active = true));

create policy "product_template_colors_admin_all"
  on public.product_template_colors
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
