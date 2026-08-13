-- Print Zones Z3 — sleeve/hat print pricing.
-- designer_pricing was keyed by (print_method_key, sides) with sides restricted to 1 (Front) or 2
-- (Back). This adds a `zone` label so the same table can hold sleeve/hat surcharges, loosens the
-- sides rule to allow zone-only rows (Front/Back still must be 1 or 2), and seeds the rates Denise set:
-- sleeves +$12 (print & embroidery), hat-back +$5 print / +$12 embroidery. Existing Front/Back prices
-- are unchanged (they gain a zone label mirroring their side). Reversible.
--
-- NOTE (named follow-up before customer cutover): the sleeve/hat rows are NOT yet editable from the
-- Pricing admin screen (it still exposes only Front/Back). Making them admin-editable is a gate before
-- ZONES_ENABLED is flipped on — no live prices that admin can't see/change.

ALTER TABLE designer_pricing ADD COLUMN zone text;
UPDATE designer_pricing SET zone = CASE sides WHEN 1 THEN 'front' WHEN 2 THEN 'back' END;
ALTER TABLE designer_pricing ALTER COLUMN sides DROP NOT NULL;
ALTER TABLE designer_pricing DROP CONSTRAINT designer_pricing_sides_check;
ALTER TABLE designer_pricing ADD CONSTRAINT designer_pricing_sides_check
  CHECK (sides IS NULL OR sides IN (1, 2));
CREATE UNIQUE INDEX designer_pricing_method_zone_uidx ON designer_pricing (print_method_key, zone);
INSERT INTO designer_pricing (print_method_key, zone, sides, price_add, is_active, label) VALUES
  ('screen_print','left_sleeve', NULL, 12, true, 'Left Sleeve'),
  ('screen_print','right_sleeve',NULL, 12, true, 'Right Sleeve'),
  ('screen_print','hat_back',    NULL,  5, true, 'Hat Back'),
  ('embroidery','left_sleeve',   NULL, 12, true, 'Left Sleeve'),
  ('embroidery','right_sleeve',  NULL, 12, true, 'Right Sleeve'),
  ('embroidery','hat_back',      NULL, 12, true, 'Hat Back');
