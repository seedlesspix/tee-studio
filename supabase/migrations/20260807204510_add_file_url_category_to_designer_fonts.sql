-- Font Management, Phase A (Denise 2026-08-07). Two additive columns on designer_fonts:
--   file_url  — the fonts-bucket URL of an uploaded font file (NULL for Google + system fonts, which
--               load from Google / the OS). Drives runtime @font-face (browser) + server outlining.
--   category  — admin-defined group name for the font picker (NULL = uncategorized). Free-form, like
--               clipart categories.
-- Purely additive + nullable; no existing rows/values change.
alter table public.designer_fonts add column if not exists file_url text;
alter table public.designer_fonts add column if not exists category text;
