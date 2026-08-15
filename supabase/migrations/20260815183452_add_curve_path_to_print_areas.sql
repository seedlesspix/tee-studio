-- Type-on-path (Z-hp-3): the admin-drawn arc a curved text follows in a print zone (hat_back primarily,
-- but any zone could carry one). Three points in the mockup's NATURAL-px space (the SAME frame as
-- x_px/y_px + mockup_natural_w/h on this row): the two endpoints and the on-curve bulge the admin drags.
-- Shape (documented, not DB-enforced):
--   { "p0": {"x":n,"y":n}, "peak": {"x":n,"y":n}, "p2": {"x":n,"y":n} }
-- NULL for every existing row and every zone without a drawn arc -> those keep using curve_degrees, which
-- stays as the fallback. Where present, curve_path supersedes curve_degrees. Additive + reversible; no
-- existing rows change.
alter table product_template_print_areas
  add column curve_path jsonb;

comment on column product_template_print_areas.curve_path is
  'Type-on-path arc (Z-hp): {p0,peak,p2} points in mockup natural-px (same frame as x_px/mockup_natural_w). NULL = use curve_degrees. Supersedes curve_degrees where set.';
