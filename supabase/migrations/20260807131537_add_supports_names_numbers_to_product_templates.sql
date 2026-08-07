-- Per-product Names & Numbers gate (Denise 2026-08-07). N&N (jersey name/number/title stacks) doesn't
-- belong on every product — accessories and the like should not offer it. This adds a yes/no flag on the
-- product template; the designer hides the Names & Numbers rail tool when it's false (same hide mechanism
-- embroidery uses). Admin toggles it per product in /admin/templates.
--
-- Additive + non-destructive: NOT NULL DEFAULT true, so every existing template keeps N&N until turned off.
ALTER TABLE public.product_templates
  ADD COLUMN IF NOT EXISTS supports_names_numbers boolean NOT NULL DEFAULT true;
