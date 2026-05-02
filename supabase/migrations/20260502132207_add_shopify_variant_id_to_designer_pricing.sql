-- Add shopify_variant_id to designer_pricing so the cart-add proxy can look up
-- the surcharge variant for each (print_method, sides) combination instead of
-- relying on hardcoded IDs in the application code.
--
-- Nullable: the 4 existing rows will be backfilled in a follow-up step once
-- the variant IDs are pulled from Shopify admin. Application code must treat
-- a NULL shopify_variant_id as a configuration error and surface a clear
-- message to the user (see CLAUDE.md "designer_pricing operational rules").

ALTER TABLE designer_pricing
  ADD COLUMN IF NOT EXISTS shopify_variant_id text;
