-- Grab 'n Go landing color, rule 2 (Denise, 2026-10-17): an art item flagged "light artwork" opens a
-- deep-linked garment in its DARKEST admin color (otherwise the admin's FIRST color) so a white design is
-- never invisible on arrival; Build 2 renders flagged art on a black tee. Admin-set checkbox in the Art
-- Library; defaults OFF for every existing item (398 today), so nothing changes until a box is ticked.
-- Additive only; no data touched; row policies unchanged (public read / admin write already cover it).
alter table public.clipart_items
  add column if not exists is_light boolean not null default false;
