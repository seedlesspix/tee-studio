ALTER TABLE public.product_templates
  ADD COLUMN volume_tiers_embroidery jsonb;

COMMENT ON COLUMN public.product_templates.volume_tiers_embroidery IS
  'Optional per-method override: embroidery-specific volume tiers for a DUAL-METHOD template. Same JSON shape as volume_tiers ([{"minQty":6,"pct":10},...]). NULL = embroidery uses volume_tiers (the default ladder). Only meaningful when the template supports both print and embroidery. Resolved to the design product''s volume.tiers metafield at add-to-cart, so the discount Function stays method-agnostic.';
