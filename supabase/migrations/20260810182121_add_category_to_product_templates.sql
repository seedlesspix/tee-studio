-- BETA #24: a simple product-category field (Unisex / Women's / Kid's / Baby's / Accessories) so the
-- designer's product picker can group + advise. Optional (nullable) text; existing templates get NULL
-- (uncategorized). No CHECK constraint, so category names can be added later without another migration.
ALTER TABLE product_templates ADD COLUMN category text;
