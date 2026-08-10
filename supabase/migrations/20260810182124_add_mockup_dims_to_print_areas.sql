-- Print-area mockup dimensions (the clean fix): record the natural pixel size of the mockup image a
-- print box was drawn on, so the designer re-projects the box against the SAME image it was drawn
-- against (fixing the off-position trap when a box is drawn on a non-primary mockup of different size).
-- Nullable; existing print areas get NULL and keep today's "first image that loads" behavior.
ALTER TABLE product_template_print_areas
  ADD COLUMN mockup_natural_w integer,
  ADD COLUMN mockup_natural_h integer;
