
CREATE TABLE public.alert_state (
  key text PRIMARY KEY,
  value text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.alert_state TO authenticated;
GRANT ALL ON public.alert_state TO service_role;
ALTER TABLE public.alert_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins read alert state" ON public.alert_state
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));
