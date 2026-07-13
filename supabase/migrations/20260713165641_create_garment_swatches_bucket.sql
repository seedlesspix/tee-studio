-- Phase 3 Day 6: public-read storage bucket for garment color swatch images.
-- 2 MB cap, PNG only. Object path convention: {template_id}/{slug(color_name)}.png
-- (collision-proof, scoped per template). Writes are admin-only via is_admin()
-- — deliberately tighter than the legacy fully-open `clipart` bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('garment-swatches', 'garment-swatches', true, 2097152, array['image/png'])
on conflict (id) do nothing;

create policy "garment_swatches_public_select" on storage.objects
  for select using (bucket_id = 'garment-swatches');

create policy "garment_swatches_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'garment-swatches' and public.is_admin());

create policy "garment_swatches_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'garment-swatches' and public.is_admin())
  with check (bucket_id = 'garment-swatches' and public.is_admin());

create policy "garment_swatches_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'garment-swatches' and public.is_admin());
