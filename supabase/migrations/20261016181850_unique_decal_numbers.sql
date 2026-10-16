-- Grab 'n Go deep links (?design=T2491) and sell-through reporting treat the DESIGN NUMBER as the identity
-- of a piece of art (Denise, 2026-10-16), so two art items may never share one. Art without a number is
-- unaffected (NULLs are excluded). Purely additive; no data is touched. Pre-checked at apply time: 1 of 398
-- items carries a number and there are 0 duplicates, so this lands cleanly. The Art admin surfaces a
-- unique violation (23505) as "Design #N is already used by another item".
create unique index clipart_items_decal_number_unique
  on public.clipart_items (decal_number)
  where decal_number is not null;
