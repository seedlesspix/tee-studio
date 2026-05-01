CREATE TABLE IF NOT EXISTS designer_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  print_method_key text NOT NULL,
  sides integer NOT NULL CHECK (sides IN (1, 2)),
  price_add numeric(10,2) NOT NULL DEFAULT 0,
  label text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(print_method_key, sides)
);

-- Insert default pricing
INSERT INTO designer_pricing (print_method_key, sides, price_add, label) VALUES
  ('screen_print', 1, 12.00, 'Screen print (1 side)'),
  ('screen_print', 2, 20.00, 'Screen print (2 sides)'),
  ('embroidery', 1, 15.00, 'Embroidery (1 side)'),
  ('embroidery', 2, 25.00, 'Embroidery (2 sides)')
ON CONFLICT (print_method_key, sides) DO NOTHING;
