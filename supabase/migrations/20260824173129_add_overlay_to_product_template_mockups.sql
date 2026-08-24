-- Layered mockups: a FOREGROUND overlay image per mockup (e.g. hoodie drawstrings) that renders ABOVE the
-- customer's placed art, so the design sits under it like a real garment. Same frame as the base mockup.
-- overlay_natural_w/h drive the admin warn-if-dims-differ guard (overlay frame vs base frame). All nullable
-- and additive: existing rows get NULL (no overlay) -> no change to any current garment. Visual only.
ALTER TABLE public.product_template_mockups
  ADD COLUMN overlay_url text,
  ADD COLUMN overlay_natural_w integer,
  ADD COLUMN overlay_natural_h integer;
