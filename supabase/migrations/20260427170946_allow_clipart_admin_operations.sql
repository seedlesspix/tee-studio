-- Drop existing restrictive policies and allow all for clipart_items
ALTER TABLE clipart_items DISABLE ROW LEVEL SECURITY;

-- Allow storage uploads to clipart bucket
DO $$
BEGIN
  DROP POLICY IF EXISTS "allow_clipart_upload" ON storage.objects;
  DROP POLICY IF EXISTS "allow_clipart_update" ON storage.objects;
  DROP POLICY IF EXISTS "allow_clipart_delete" ON storage.objects;

  CREATE POLICY "allow_clipart_upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'clipart');
  CREATE POLICY "allow_clipart_update" ON storage.objects FOR UPDATE USING (bucket_id = 'clipart');
  CREATE POLICY "allow_clipart_delete" ON storage.objects FOR DELETE USING (bucket_id = 'clipart');
END $$;
