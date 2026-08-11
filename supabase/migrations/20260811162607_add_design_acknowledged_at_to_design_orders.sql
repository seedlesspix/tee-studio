-- Item 32(b): pre-cart design acknowledgment.
-- Adds a nullable timestamp to design_orders. It's empty until a customer actively ticks the
-- "I've reviewed my design" box on the Order page and adds to cart, at which point it's set to that
-- moment — dated proof that the customer confirmed the design (spelling / quality / placement) before
-- ordering. Purely additive; nothing on existing rows changes; reversible.

ALTER TABLE public.design_orders
  ADD COLUMN design_acknowledged_at timestamptz;
