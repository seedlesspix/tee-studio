-- Phase 3 sign-off: retain the ORIGINAL uploaded file alongside its display
-- rendition. The print shop needs vector originals; today it gets a PNG.
--
-- Nothing was lost at conversion — Cloudinary keeps the original, and the
-- `/upload/f_png/` segment is a DELIVERY-TIME transformation, not a destructive
-- one. We simply never recorded where the original was, and overwrote file_type
-- with 'image/png'. This records it.
alter table public.customer_uploads
  add column if not exists original_url text,
  add column if not exists original_format text;

-- Backfill what we can prove:
--   original_url    = the stored URL minus the f_png delivery segment. For a
--                     plain raster the stored URL already IS the original, so the
--                     replace is a no-op — correct in both cases.
--   original_format = the real extension, recovered from the filename we kept
--                     ("logo.ai" -> "ai"), since file_type was overwritten.
update public.customer_uploads
set original_url = replace(cloudinary_url, '/upload/f_png/', '/upload/'),
    original_format = lower(nullif(regexp_replace(file_name, '^.*\.', ''), file_name))
where original_url is null;
