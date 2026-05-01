ALTER TABLE design_orders
ADD COLUMN IF NOT EXISTS shopify_order_id text,
ADD COLUMN IF NOT EXISTS shopify_order_number text,
ADD COLUMN IF NOT EXISTS customer_name text,
ADD COLUMN IF NOT EXISTS customer_email text,
ADD COLUMN IF NOT EXISTS customer_phone text,
ADD COLUMN IF NOT EXISTS shipping_address jsonb;

-- Index for webhook lookups
CREATE INDEX IF NOT EXISTS idx_design_orders_shopify_order ON design_orders(shopify_order_id);
CREATE INDEX IF NOT EXISTS idx_design_orders_status ON design_orders(status);
