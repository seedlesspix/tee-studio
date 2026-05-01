ALTER TABLE clipart_items ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';
CREATE INDEX IF NOT EXISTS clipart_items_tags_idx ON clipart_items USING GIN(tags);
