CREATE TABLE public.ui_strings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ui_strings ENABLE ROW LEVEL SECURITY;

CREATE POLICY ui_strings_public_read ON public.ui_strings
  FOR SELECT USING (true);

CREATE POLICY ui_strings_admin_all ON public.ui_strings
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE TRIGGER ui_strings_set_updated_at
  BEFORE UPDATE ON public.ui_strings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
