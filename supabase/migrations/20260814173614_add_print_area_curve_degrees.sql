-- Hat-Back Auto-Curve (Z-hat-1) — per-zone arc config.
-- Adds one optional signed-integer column to product_template_print_areas: how far a hat_back zone's
-- text arcs to follow the cap opening. Sign = direction, matching the app's Curve slider: POSITIVE =
-- frown ∩ (over the opening), negative = smile ∪; magnitude = subtended degrees. NULL for every
-- non-hat_back zone (front/back/sleeves ignore it). The designer falls back to +45 (gentle frown) for a
-- hat_back zone when this is NULL. A range check keeps it within the curve engine's -360..360. Additive +
-- reversible; no existing rows change. (Sign in this comment corrected 2026-08-14 to match shipped behavior.)

ALTER TABLE product_template_print_areas ADD COLUMN curve_degrees integer;

ALTER TABLE product_template_print_areas ADD CONSTRAINT print_areas_curve_degrees_range
  CHECK (curve_degrees IS NULL OR (curve_degrees BETWEEN -360 AND 360));

COMMENT ON COLUMN product_template_print_areas.curve_degrees IS
  'Hat-back auto-curve: signed arc degrees the text follows (POSITIVE=frown ∩ over the opening, negative=smile ∪; magnitude=subtended degrees), matching the Curve slider. NULL for all non-hat_back zones. Designer falls back to +45 (gentle frown) for a hat_back zone when NULL.';
