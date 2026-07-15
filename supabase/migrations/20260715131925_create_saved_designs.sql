-- Phase 3 Day 8: "My Designs" — a customer's saved-design library.
-- Mirrors the Day-7 customer_uploads pattern: an INDEX of design_orders rows the
-- customer chose to keep. Ownership lives HERE, not on design_orders, on
-- purpose: design_orders carries a blanket anon read policy (every non-completed
-- row, no id required), so stamping the customer id there would make "which
-- customer owns which design" world-readable and enumerable. RLS is ENABLED with
-- NO policies — only the service-role route touches it, deriving the owner
-- server-side (verified Shopify customer id, else the HttpOnly tee_session).
create table public.saved_designs (
  id uuid primary key default gen_random_uuid(),
  design_order_id uuid not null references public.design_orders(id) on delete cascade,
  session_id uuid,                       -- anonymous owner
  shopify_customer_id text,              -- owner after login/adoption
  name text,                             -- customer's label; null = untitled
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_designs_has_owner
    check (session_id is not null or shopify_customer_id is not null)
);

create unique index saved_designs_design_idx   on public.saved_designs (design_order_id);
create index        saved_designs_session_idx  on public.saved_designs (session_id, updated_at desc);
create index        saved_designs_customer_idx on public.saved_designs (shopify_customer_id, updated_at desc);

-- Reuse the trigger fn added by create_product_templates.
create trigger saved_designs_set_updated_at
  before update on public.saved_designs
  for each row execute function public.set_updated_at();

alter table public.saved_designs enable row level security;
-- No policies, on purpose: all access flows through the service-role route.
