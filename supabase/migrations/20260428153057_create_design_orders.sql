-- Store customer design sessions
CREATE TABLE IF NOT EXISTS design_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),

  -- Product info
  shopify_product_id text,
  shopify_variant_id text,
  product_title text,
  selected_color text,

  -- Print info
  print_method text,
  sides_designed integer DEFAULT 1,

  -- Design files (Supabase Storage URLs)
  canvas_png_front text,    -- PNG snapshot of front design
  canvas_png_back text,     -- PNG snapshot of back design
  canvas_svg_front text,    -- SVG export of front design
  canvas_svg_back text,     -- SVG export of back design
  canvas_json_front text,   -- Fabric.js JSON state front
  canvas_json_back text,    -- Fabric.js JSON state back

  -- Customer uploaded files (array of URLs)
  uploaded_files jsonb DEFAULT '[]',

  -- Order details
  quantities jsonb DEFAULT '{}',
  unit_price numeric(10,2),
  print_charge numeric(10,2),
  price_per_item numeric(10,2),
  total_qty integer DEFAULT 0,
  total_price numeric(10,2),

  -- Status
  status text DEFAULT 'draft',
  shopify_cart_url text,
  notes text
);

-- No RLS needed - server side only
ALTER TABLE design_orders DISABLE ROW LEVEL SECURITY;

-- Storage bucket for customer uploads and design exports
INSERT INTO storage.buckets (id, name, public)
VALUES ('design-exports', 'design-exports', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('customer-uploads', 'customer-uploads', false)
ON CONFLICT (id) DO NOTHING;
