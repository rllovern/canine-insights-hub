
CREATE TABLE public.alert_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.alert_recipients TO authenticated;
GRANT ALL ON public.alert_recipients TO service_role;
ALTER TABLE public.alert_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins manage alert recipients" ON public.alert_recipients
  FOR ALL TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TABLE public.alert_runbook (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  match_pattern text,
  error_class text NOT NULL,
  self_heals boolean NOT NULL DEFAULT false,
  title text NOT NULL,
  fix_steps text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.alert_runbook TO authenticated;
GRANT ALL ON public.alert_runbook TO service_role;
ALTER TABLE public.alert_runbook ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins manage alert runbook" ON public.alert_runbook
  FOR ALL TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TABLE public.data_source_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  error_class text NOT NULL,
  runbook_id uuid REFERENCES public.alert_runbook(id),
  affected_property_ids uuid[] NOT NULL DEFAULT '{}',
  first_error text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  last_notified_at timestamptz,
  reminder_count integer NOT NULL DEFAULT 0,
  resolved_at timestamptz,
  muted boolean NOT NULL DEFAULT false,
  mute_reason text
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_source_incidents TO authenticated;
GRANT ALL ON public.data_source_incidents TO service_role;
ALTER TABLE public.data_source_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins manage data source incidents" ON public.data_source_incidents
  FOR ALL TO authenticated USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

CREATE INDEX idx_data_source_incidents_open ON public.data_source_incidents (source, runbook_id) WHERE resolved_at IS NULL;

ALTER TABLE public.property_data_sources
  ADD COLUMN IF NOT EXISTS alerts_muted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS alerts_mute_reason text;
