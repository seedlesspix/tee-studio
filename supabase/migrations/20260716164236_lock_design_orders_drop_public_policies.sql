-- BLOCKER-1 lockdown (Phase 4 Days 2-3): design_orders joins the locked-table
-- pattern (customer_uploads, saved_designs). All anonymous access now flows
-- through /api/design-orders + /api/designs/draft on the service role, keyed
-- by exact UUID (URL-as-key, unchanged). These three blanket public policies
-- allowed listing every draft and updating any non-completed row with the
-- anon key alone — the enumerable-drafts hole found at Phase 3 Day 8.
--
-- design_orders_admin_all (authenticated + is_admin()) is deliberately kept:
-- the admin Orders page reads through it. RLS stays enabled.

drop policy if exists design_orders_public_read   on public.design_orders;
drop policy if exists design_orders_public_insert on public.design_orders;
drop policy if exists design_orders_public_update on public.design_orders;
