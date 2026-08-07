-- Decal Designs, unified Art model (Denise 2026-08-07). Art is no longer locked to one category or one
-- print method. Each art now declares WHICH methods it supports (Print and/or Embroidery) and can belong
-- to SEVERAL categories at once (e.g. a Chicago-clover flag in both "Chicago" and "Holidays"). Customers
-- browse by category and search by Decal #. Both new columns are arrays (same pattern as
-- product_templates.supported_print_methods), so no new table or RLS policy is needed — they inherit
-- clipart_items' existing public-read / admin-write rules. Additive + backfilled from the current
-- single-category / single-method values, so nothing existing is lost. The old single-category
-- (category_id) and single-method (print_method_key) fields remain but stop being read by the app.

-- 1. Which print methods this art is available for, e.g. {screen_print, embroidery}.
ALTER TABLE public.clipart_items
  ADD COLUMN IF NOT EXISTS supported_methods text[] NOT NULL DEFAULT '{}';

-- 2. Which categories this art appears in (many). Replaces the single category_id going forward.
ALTER TABLE public.clipart_items
  ADD COLUMN IF NOT EXISTS category_ids uuid[] NOT NULL DEFAULT '{}';

-- 3. Backfill from the existing single-category / single-method model so nothing is lost.
UPDATE public.clipart_items
  SET supported_methods = ARRAY[print_method_key]
  WHERE print_method_key IS NOT NULL AND cardinality(supported_methods) = 0;

UPDATE public.clipart_items
  SET category_ids = ARRAY[category_id]
  WHERE category_id IS NOT NULL AND cardinality(category_ids) = 0;
