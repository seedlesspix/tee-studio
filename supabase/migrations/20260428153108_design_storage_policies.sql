CREATE POLICY "design_exports_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'design-exports');
CREATE POLICY "design_exports_select" ON storage.objects FOR SELECT USING (bucket_id = 'design-exports');
CREATE POLICY "customer_uploads_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'customer-uploads');
CREATE POLICY "customer_uploads_select" ON storage.objects FOR SELECT USING (bucket_id = 'customer-uploads');
