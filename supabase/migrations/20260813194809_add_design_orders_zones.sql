-- Print Zones Z3 — per-zone design capture.
-- Adds one optional jsonb column to design_orders holding the design for EVERY print zone
-- (front, back, left_sleeve, right_sleeve, hat_back) in one place. Front/back stay mirrored to the
-- legacy *_front/*_back columns for back-compat, so existing readers (order page, admin, cut-file,
-- My Designs) keep working; new zone-aware readers use this column. Existing orders are untouched
-- (the column is simply null for them). Reversible.

ALTER TABLE design_orders ADD COLUMN zones jsonb;
COMMENT ON COLUMN design_orders.zones IS
  'Per-zone design map: {"<zone>":{canvas_json,canvas_png,canvas_svg,print_area,print_area_id,print_charge}}. Front/back also mirrored to legacy *_front/*_back columns for back-compat.';
