-- A. Mark dplumb@mac.com as admin via JWT app_metadata
UPDATE auth.users
SET raw_app_meta_data = jsonb_set(
  COALESCE(raw_app_meta_data, '{}'::jsonb),
  '{is_admin}',
  'true'::jsonb
)
WHERE email = 'dplumb@mac.com';

-- B. Helper function: read is_admin from JWT
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean,
    false
  );
$$;

-- C. clipart_items: drop bad pre-existing policies, add proper ones, enable RLS
DROP POLICY IF EXISTS "Allow insert clipart items"  ON public.clipart_items;
DROP POLICY IF EXISTS "Public read clipart items"   ON public.clipart_items;
DROP POLICY IF EXISTS "Clipart items are public"    ON public.clipart_items;

CREATE POLICY "clipart_items_public_read" ON public.clipart_items
  FOR SELECT TO anon, authenticated
  USING (is_active = true);

CREATE POLICY "clipart_items_admin_all" ON public.clipart_items
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

ALTER TABLE public.clipart_items ENABLE ROW LEVEL SECURITY;

-- D. designer_pricing
CREATE POLICY "designer_pricing_public_read" ON public.designer_pricing
  FOR SELECT TO anon, authenticated
  USING (is_active = true);

CREATE POLICY "designer_pricing_admin_all" ON public.designer_pricing
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

ALTER TABLE public.designer_pricing ENABLE ROW LEVEL SECURITY;

-- E. design_orders
-- Public SELECT: only non-completed orders (PII protected)
CREATE POLICY "design_orders_public_read" ON public.design_orders
  FOR SELECT TO anon, authenticated
  USING (status IS NULL OR status != 'completed');

-- Public INSERT: new draft orders only, no Shopify fields
CREATE POLICY "design_orders_public_insert" ON public.design_orders
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    (status IS NULL OR status IN ('draft', 'ordering', 'cart_created'))
    AND shopify_order_id IS NULL
    AND shopify_order_number IS NULL
  );

-- Public UPDATE: only on non-completed orders, can't tamper with Shopify fields
CREATE POLICY "design_orders_public_update" ON public.design_orders
  FOR UPDATE TO anon, authenticated
  USING (status IN ('draft', 'ordering', 'cart_created'))
  WITH CHECK (
    status IN ('draft', 'ordering', 'cart_created')
    AND shopify_order_id IS NULL
    AND shopify_order_number IS NULL
  );

-- Admin: full access
CREATE POLICY "design_orders_admin_all" ON public.design_orders
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

ALTER TABLE public.design_orders ENABLE ROW LEVEL SECURITY;
