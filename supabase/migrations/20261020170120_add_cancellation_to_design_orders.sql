-- Shopify order cancellations (Denise, 2026-10-20): when Shopify sends orders/cancelled, record it on the
-- paid design_orders row(s) WITHOUT changing status (the row stays 'completed' = paid, so every rule keyed
-- on 'completed' — admin-only access, no cart link, not re-orderable — keeps applying). The admin derives
-- the "Cancelled" label from cancelled_at. Additive, nullable; no data touched; policies unchanged.
alter table public.design_orders
  add column if not exists cancelled_at  timestamptz,
  add column if not exists cancel_reason text;
