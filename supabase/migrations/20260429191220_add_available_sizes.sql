ALTER TABLE design_orders ADD COLUMN IF NOT EXISTS available_sizes text[] DEFAULT '{}';
