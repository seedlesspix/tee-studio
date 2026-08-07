ALTER TABLE public.product_templates
  ADD COLUMN volume_tiers jsonb;

COMMENT ON COLUMN public.product_templates.volume_tiers IS
  'Per-garment volume discount tiers as JSON: [{"minQty":6,"pct":10},...] sorted ascending by minQty. NULL or empty = no volume discount for this garment. Drives the Order-Page incentive ladder AND the volume.tiers metafield stamped on each ephemeral design product, which the Shopify discount Function reads to apply the % at checkout.';
