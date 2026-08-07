-- Decal Designs, Parts 1 & 2 (Denise 2026-08-07). Pre-made "design" artwork (decals) can now be
-- browsed as their own section in the designer (separate from generic clipart), each carries a decal
-- NUMBER the admin assigns, and every order records the LIST of decals placed on it for sell-through
-- reporting. All three columns are additive + nullable/defaulted + non-destructive; no existing data is
-- touched, no columns dropped, and RLS is row-level so the new columns inherit the current policies
-- with zero policy change.

-- 1. Mark a clipart category as a "Designs" (decal) category vs generic clipart. Defaults false, so
--    every existing category stays regular clipart.
ALTER TABLE public.clipart_categories
  ADD COLUMN IF NOT EXISTS is_design boolean NOT NULL DEFAULT false;

-- 2. The decal number the admin assigns per item (only meaningful for items in a Designs category).
ALTER TABLE public.clipart_items
  ADD COLUMN IF NOT EXISTS decal_number integer;

-- 3. The list of decals used on an order: [{ "number": 1024, "name": "Eagle" }, ...]. NULL for orders
--    with no decals, mirroring the roster/uploaded_files list-column pattern.
ALTER TABLE public.design_orders
  ADD COLUMN IF NOT EXISTS decals_used jsonb;
