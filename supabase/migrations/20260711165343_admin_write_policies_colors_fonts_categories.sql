-- Day 2: admin write policies for Phase 2 CRUD (Colors, Fonts) + fix
-- clipart_categories create. Mirrors the existing designer_pricing_admin_all
-- and clipart_items_admin_all pattern: public read stays as-is; only
-- is_admin() JWTs may INSERT/UPDATE/DELETE. Additive and reversible.

-- Colors: enable admin CRUD (Item 18)
create policy "designer_colors_admin_all"
  on public.designer_colors
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Fonts: enable admin CRUD (Item 17)
create policy "designer_fonts_admin_all"
  on public.designer_fonts
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Clipart categories: fix the broken "+ New category" button (no write
-- policy existed; only a public-read policy was present)
create policy "clipart_categories_admin_all"
  on public.clipart_categories
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
