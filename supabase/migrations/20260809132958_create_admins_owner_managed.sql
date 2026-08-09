-- Owner-managed admin list (BETA #23). The `admins` table is the single source of who can access the
-- admin area + write data; is_admin() now reads it (was the app_metadata.is_admin JWT flag). Only the
-- OWNER (is_owner=true) can manage the list. Seeds dplumb@mac.com as the sole owner.
CREATE TABLE public.admins (
  email      text PRIMARY KEY,
  is_owner   boolean NOT NULL DEFAULT false,
  note       text,
  added_by   text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admins WHERE email = lower(auth.jwt() ->> 'email')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin_owner()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admins WHERE email = lower(auth.jwt() ->> 'email') AND is_owner = true
  );
$$;

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
CREATE POLICY admins_owner_all ON public.admins
  FOR ALL USING (public.is_admin_owner()) WITH CHECK (public.is_admin_owner());

INSERT INTO public.admins (email, is_owner, note) VALUES ('dplumb@mac.com', true, 'Owner')
ON CONFLICT (email) DO UPDATE SET is_owner = true;
