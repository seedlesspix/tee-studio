-- Drop existing storage policies for clipart and make fully open
DROP POLICY IF EXISTS "allow_clipart_upload" ON storage.objects;
DROP POLICY IF EXISTS "allow_clipart_update" ON storage.objects;
DROP POLICY IF EXISTS "allow_clipart_delete" ON storage.objects;

-- Allow anyone to upload/update/delete in clipart bucket (admin page is password protected)
CREATE POLICY "clipart_public_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'clipart');

CREATE POLICY "clipart_public_update" ON storage.objects
  FOR UPDATE USING (bucket_id = 'clipart') WITH CHECK (bucket_id = 'clipart');

CREATE POLICY "clipart_public_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'clipart');

CREATE POLICY "clipart_public_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'clipart');
