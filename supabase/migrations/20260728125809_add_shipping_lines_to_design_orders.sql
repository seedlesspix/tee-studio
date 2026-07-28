-- Phase 4: capture the order's fulfillment method at order-paid so the admin
-- can show a PICKUP/SHIP badge and the shop has pickup-vs-ship reporting.
-- Verbatim capture (raw Shopify shipping_lines array) — the pickup/ship
-- discriminator is derived later in the display layer from real data, not
-- guessed at capture time. For design-product orders this is the ONLY path:
-- those orders are invisible to the app via the Admin API, so if the webhook
-- doesn't grab this at order-paid it's unrecoverable.
ALTER TABLE public.design_orders ADD COLUMN shipping_lines jsonb;
