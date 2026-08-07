-- Font Management, Phase A (Denise 2026-08-07). A storage bucket for admin-uploaded font files.
-- Mirrors the garment-swatches bucket: public READ (the browser injects @font-face from these URLs AND
-- the server cut-file outliner fetches the file to outline glyphs), admin-only WRITE (is_admin()).
-- Font MIME types vary a lot by OS/browser, so several are allowed plus octet-stream as a catch-all.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fonts', 'fonts', true, 10485760,
  array['font/ttf','font/otf','font/woff','font/woff2','application/font-sfnt',
        'application/x-font-ttf','application/x-font-opentype','application/vnd.ms-opentype','application/octet-stream'])
on conflict (id) do nothing;

create policy "fonts_public_select" on storage.objects
  for select using (bucket_id = 'fonts');
create policy "fonts_admin_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'fonts' and public.is_admin());
create policy "fonts_admin_update" on storage.objects
  for update to authenticated using (bucket_id = 'fonts' and public.is_admin()) with check (bucket_id = 'fonts' and public.is_admin());
create policy "fonts_admin_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'fonts' and public.is_admin());
