-- Print Zones Z0: designer mockups move into the template admin (single source).
-- product_template_mockups holds one designer mockup image per template × color × zone (front, back,
-- left_sleeve, right_sleeve, hat_back, …). Public read (the designer loads them), admin-only write
-- (mirrors product_template_colors / product_template_print_areas), cascade-deletes with its template,
-- one image per (template, color, zone). product_templates.style_number lets the batch uploader's
-- filename token (e.g. "2001" in 2001_White_LeftSleeve.png) resolve to a template. Purely additive.

create table public.product_template_mockups (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.product_templates(id) on delete cascade,
  color_name  text not null,
  zone        text not null,
  image_url   text not null,
  natural_w   integer,
  natural_h   integer,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (template_id, color_name, zone)
);
alter table public.product_template_mockups enable row level security;
create policy "mockups public read"  on public.product_template_mockups for select using (true);
create policy "mockups admin write"  on public.product_template_mockups for all
  using (public.is_admin()) with check (public.is_admin());

alter table public.product_templates add column style_number text;
