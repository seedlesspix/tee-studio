-- Phase 3 Day 4: capture the per-side print-charge split on design_orders.
-- Until now only the summed print_charge was stored; these record the Front
-- and Back amounts independently (e.g. $12 + $12) for fulfillment/accounting
-- and so the Order Options page can read exact per-side amounts instead of
-- deriving them. Both nullable → safe on existing rows. Additive, reversible.
alter table public.design_orders
  add column if not exists print_charge_front numeric,
  add column if not exists print_charge_back numeric;
