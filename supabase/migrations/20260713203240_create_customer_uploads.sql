-- Phase 3 Day 7: "My Uploads" — an INDEX of customer-uploaded artwork.
-- Files live in Cloudinary (unchanged); this table only points at them, so
-- deleting a row never deletes a file (a file may be referenced by a saved
-- design). Ownership is an anonymous session_id OR a shopify_customer_id; on
-- login the session's rows are adopted (customer id stamped on).
--
-- Access is entirely server-mediated: /api/uploads derives the owner from an
-- HttpOnly session cookie (anon) or the verified Shopify session (logged-in)
-- and uses the service-role key. Customers authenticate to Shopify, not
-- Supabase, so the DB has no trusted view of their identity — hence RLS is
-- ENABLED with NO policies (anon/authenticated get nothing; only the service
-- role, i.e. our route, can touch it).
create table public.customer_uploads (
  id uuid primary key default gen_random_uuid(),
  session_id uuid,                         -- anonymous owner
  shopify_customer_id text,                -- owner after login/adoption
  cloudinary_url text not null,
  cloudinary_public_id text,               -- kept for reference; never auto-deleted
  file_name text not null,
  file_type text,
  source text,                             -- 'raster' | 'converted' | 'pdf'
  width integer,
  height integer,
  created_at timestamptz not null default now(),
  constraint customer_uploads_has_owner
    check (session_id is not null or shopify_customer_id is not null)
);

create index customer_uploads_session_idx  on public.customer_uploads (session_id, created_at desc);
create index customer_uploads_customer_idx on public.customer_uploads (shopify_customer_id, created_at desc);

alter table public.customer_uploads enable row level security;
-- No policies, on purpose: all access flows through the service-role server route.
