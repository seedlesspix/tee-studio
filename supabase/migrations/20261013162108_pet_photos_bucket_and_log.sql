-- Storage bucket for Pet Portrait Hat customer photos.
-- Public read (links go on Shopify orders), unguessable filenames, 15 MB cap.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pet-photos', 'pet-photos', true, 15728640,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif']
)
on conflict (id) do nothing;

-- Nobody writes to this bucket from the browser; only the upload function (service role) does.
-- (No insert/update/delete policies for anon/authenticated on purpose.)

-- A log of every upload so we can build a "portraits to draw" queue later.
create table if not exists public.pet_photo_uploads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  storage_path text not null,
  public_url text not null,
  original_name text,
  mime_type text,
  bytes integer,
  product_handle text,
  variant_title text,
  shopify_order_name text,
  notes text
);

alter table public.pet_photo_uploads enable row level security;
-- No policies: only the service role (the upload function + you in the dashboard) can read/write.

create index if not exists pet_photo_uploads_created_at_idx on public.pet_photo_uploads (created_at desc);
