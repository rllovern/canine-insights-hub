
-- 1. Announcements ---------------------------------------------------------
CREATE TABLE public.site_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  audience text NOT NULL DEFAULT 'all',
  audience_roles app_role[],
  audience_property_ids uuid[],
  frequency text NOT NULL DEFAULT 'once',
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_announcements TO authenticated;
GRANT ALL ON public.site_announcements TO service_role;
ALTER TABLE public.site_announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins manage announcements"
  ON public.site_announcements FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "Signed-in users read active announcements"
  ON public.site_announcements FOR SELECT TO authenticated
  USING (active = true);

CREATE TRIGGER site_announcements_set_updated_at
  BEFORE UPDATE ON public.site_announcements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Dismissals -------------------------------------------------------------
CREATE TABLE public.announcement_dismissals (
  announcement_id uuid NOT NULL REFERENCES public.site_announcements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);

GRANT SELECT, INSERT, DELETE ON public.announcement_dismissals TO authenticated;
GRANT ALL ON public.announcement_dismissals TO service_role;
ALTER TABLE public.announcement_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own dismissals"
  ON public.announcement_dismissals FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin(auth.uid()));

CREATE POLICY "Users insert own dismissals"
  ON public.announcement_dismissals FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users delete own dismissals"
  ON public.announcement_dismissals FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- 3. Maintenance mode -------------------------------------------------------
CREATE TABLE public.maintenance_mode (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  active boolean NOT NULL DEFAULT false,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  expected_back_at timestamptz,
  message text NOT NULL DEFAULT 'The dashboard is down for scheduled maintenance.',
  started_by uuid,
  started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.maintenance_mode TO authenticated;
GRANT SELECT ON public.maintenance_mode TO anon;
GRANT ALL ON public.maintenance_mode TO service_role;
ALTER TABLE public.maintenance_mode ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone may read maintenance state"
  ON public.maintenance_mode FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "Super admins update maintenance state"
  ON public.maintenance_mode FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

INSERT INTO public.maintenance_mode (id) VALUES (1);

-- 4. Incident notice settings + incident columns ----------------------------
CREATE TABLE public.incident_notice_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  auto_notice_after_hours int NOT NULL DEFAULT 12,
  notice_title text NOT NULL DEFAULT 'Some data is delayed',
  notice_body text NOT NULL DEFAULT '{source} data for {location} has not updated since {since}. Figures on this dashboard may be incomplete until it catches up. The issue has been flagged and is being looked into.',
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.incident_notice_settings TO authenticated;
GRANT ALL ON public.incident_notice_settings TO service_role;
ALTER TABLE public.incident_notice_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users read notice settings"
  ON public.incident_notice_settings FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Super admins update notice settings"
  ON public.incident_notice_settings FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

INSERT INTO public.incident_notice_settings (id) VALUES (1);

ALTER TABLE public.data_source_incidents
  ADD COLUMN acknowledged_at timestamptz,
  ADD COLUMN acknowledged_by uuid,
  ADD COLUMN owner_notice text NOT NULL DEFAULT 'auto';

CREATE POLICY "Signed-in users read open incidents"
  ON public.data_source_incidents FOR SELECT TO authenticated
  USING (resolved_at IS NULL);
