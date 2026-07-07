-- =============================================================
-- Role helpers (all SECURITY DEFINER, locked to authenticated)
-- =============================================================

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin')
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('super_admin','admin')
  )
$$;

CREATE OR REPLACE FUNCTION public.is_all_properties_reader(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('super_admin','admin','owner')
  )
$$;

CREATE OR REPLACE FUNCTION public.can_access_property(_user_id uuid, _property_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.is_all_properties_reader(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = _user_id
        AND ur.role = 'location_owner'
        AND EXISTS (
          SELECT 1 FROM public.viewer_property_access vpa
          WHERE vpa.user_id = _user_id AND vpa.property_id = _property_id
        )
    )
$$;

REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_all_properties_reader(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_access_property(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_all_properties_reader(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_property(uuid, uuid) TO authenticated;

-- Redefine lead_perf helpers on top of the new model
CREATE OR REPLACE FUNCTION public.lead_perf_can_read(_user_id uuid, _property_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_access_property(_user_id, _property_id)
$$;

CREATE OR REPLACE FUNCTION public.lead_perf_check_access(_property_ids uuid[])
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _pid uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF public.is_all_properties_reader(_uid) THEN RETURN; END IF;
  IF _property_ids IS NULL THEN RAISE EXCEPTION 'agency scope requires internal role'; END IF;
  FOREACH _pid IN ARRAY _property_ids LOOP
    IF NOT public.can_access_property(_uid, _pid) THEN
      RAISE EXCEPTION 'access denied for property %', _pid;
    END IF;
  END LOOP;
END $$;

-- API health summary now visible to any all-properties reader (Super Admin, Admin, Owner)
CREATE OR REPLACE FUNCTION public.get_api_health_summary()
RETURNS TABLE(source text, property_id uuid, property_name text, is_connected boolean,
              last_success_at timestamptz, last_failure_at timestamptz,
              last_error_message text, last_run_status text, last_run_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_all_properties_reader(auth.uid()) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  WITH sources AS (SELECT unnest(ARRAY['google_ads','ctm','ga4','keyword_com','ghl']) AS source),
  props AS (SELECT p.id, p.name FROM public.properties p WHERE p.is_active = true),
  pairs AS (SELECT s.source, p.id AS property_id, p.name AS property_name FROM sources s CROSS JOIN props p),
  conn AS (SELECT pds.property_id, pds.source, COALESCE(pds.is_connected, false) AS is_connected FROM public.property_data_sources pds),
  last_success AS (
    SELECT DISTINCT ON (sr.property_id, sr.source)
      sr.property_id, sr.source, sr.started_at AS last_success_at
    FROM public.sync_runs sr WHERE sr.status='success'
    ORDER BY sr.property_id, sr.source, sr.started_at DESC),
  last_failure AS (
    SELECT DISTINCT ON (sr.property_id, sr.source)
      sr.property_id, sr.source, sr.started_at AS last_failure_at,
      COALESCE(sr.error_message, sr.error) AS last_error_message
    FROM public.sync_runs sr WHERE sr.status='failure'
    ORDER BY sr.property_id, sr.source, sr.started_at DESC),
  last_any AS (
    SELECT DISTINCT ON (sr.property_id, sr.source)
      sr.property_id, sr.source, sr.status AS last_run_status, sr.started_at AS last_run_at
    FROM public.sync_runs sr
    ORDER BY sr.property_id, sr.source, sr.started_at DESC)
  SELECT pr.source, pr.property_id, pr.property_name,
    COALESCE(c.is_connected, false), ls.last_success_at, lf.last_failure_at,
    lf.last_error_message, la.last_run_status, la.last_run_at
  FROM pairs pr
  LEFT JOIN conn c ON c.property_id=pr.property_id AND c.source=pr.source
  LEFT JOIN last_success ls ON ls.property_id=pr.property_id AND ls.source=pr.source
  LEFT JOIN last_failure lf ON lf.property_id=pr.property_id AND lf.source=pr.source
  LEFT JOIN last_any la ON la.property_id=pr.property_id AND la.source=pr.source
  ORDER BY pr.source, pr.property_name;
END; $$;

-- =============================================================
-- Reassign existing user_roles rows
-- =============================================================

-- Rob (super admin)
DELETE FROM public.user_roles
WHERE user_id = '5a69d56f-7ae2-421b-8220-c741491511ed'::uuid AND role = 'internal';
INSERT INTO public.user_roles (user_id, role)
VALUES ('5a69d56f-7ae2-421b-8220-c741491511ed'::uuid, 'super_admin')
ON CONFLICT (user_id, role) DO NOTHING;

-- Bob (owner) — remove viewer role; keep viewer_property_access rows harmless
DELETE FROM public.user_roles
WHERE user_id = '76ee5d03-a371-47bd-b822-7b223e4f4a70'::uuid AND role = 'viewer';
INSERT INTO public.user_roles (user_id, role)
VALUES ('76ee5d03-a371-47bd-b822-7b223e4f4a70'::uuid, 'owner')
ON CONFLICT (user_id, role) DO NOTHING;

-- Any remaining legacy 'internal' users become admin
INSERT INTO public.user_roles (user_id, role)
SELECT user_id, 'admin'::app_role FROM public.user_roles
WHERE role = 'internal'
  AND user_id NOT IN (SELECT user_id FROM public.user_roles WHERE role IN ('super_admin','admin'))
ON CONFLICT (user_id, role) DO NOTHING;
DELETE FROM public.user_roles WHERE role = 'internal';

-- Any remaining legacy 'viewer' users become location_owner
INSERT INTO public.user_roles (user_id, role)
SELECT user_id, 'location_owner'::app_role FROM public.user_roles
WHERE role = 'viewer'
  AND user_id NOT IN (SELECT user_id FROM public.user_roles WHERE role = 'location_owner')
ON CONFLICT (user_id, role) DO NOTHING;
DELETE FROM public.user_roles WHERE role = 'viewer';

-- =============================================================
-- Rewrite RLS policies
-- =============================================================

-- agency_sla_defaults
DROP POLICY IF EXISTS "agency_sla internal write" ON public.agency_sla_defaults;
DROP POLICY IF EXISTS "agency_sla read" ON public.agency_sla_defaults;
CREATE POLICY "agency_sla read" ON public.agency_sla_defaults FOR SELECT USING (true);
CREATE POLICY "agency_sla super admin write" ON public.agency_sla_defaults FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- ai_agent_messages / reports / sessions / tool_runs — session-owner scoped, staff can read
DROP POLICY IF EXISTS "session owner read messages" ON public.ai_agent_messages;
CREATE POLICY "session owner read messages" ON public.ai_agent_messages FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.ai_agent_sessions s
    WHERE s.id = ai_agent_messages.session_id
      AND (s.user_id = auth.uid() OR public.is_staff(auth.uid()))));

DROP POLICY IF EXISTS "owner read reports" ON public.ai_agent_reports;
CREATE POLICY "owner read reports" ON public.ai_agent_reports FOR SELECT
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "owner read sessions" ON public.ai_agent_sessions;
CREATE POLICY "owner read sessions" ON public.ai_agent_sessions FOR SELECT
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "session owner read tool runs" ON public.ai_agent_tool_runs;
CREATE POLICY "session owner read tool runs" ON public.ai_agent_tool_runs FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.ai_agent_sessions s
    WHERE s.id = ai_agent_tool_runs.session_id
      AND (s.user_id = auth.uid() OR public.is_staff(auth.uid()))));

-- budget_accounts (no property scope)
DROP POLICY IF EXISTS "internal read budget_accounts" ON public.budget_accounts;
DROP POLICY IF EXISTS "internal write budget_accounts" ON public.budget_accounts;
CREATE POLICY "staff read budget_accounts" ON public.budget_accounts FOR SELECT
  USING (public.is_all_properties_reader(auth.uid()));
CREATE POLICY "super admin write budget_accounts" ON public.budget_accounts FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- campaign_budgets
DROP POLICY IF EXISTS "internal read campaign_budgets" ON public.campaign_budgets;
DROP POLICY IF EXISTS "viewer read campaign_budgets" ON public.campaign_budgets;
CREATE POLICY "read campaign_budgets" ON public.campaign_budgets FOR SELECT
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "super admin write campaign_budgets" ON public.campaign_budgets FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- campaign_labels
DROP POLICY IF EXISTS "internal read campaign_labels" ON public.campaign_labels;
DROP POLICY IF EXISTS "viewer read campaign_labels" ON public.campaign_labels;
CREATE POLICY "read campaign_labels" ON public.campaign_labels FOR SELECT
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "super admin write campaign_labels" ON public.campaign_labels FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- ctm_calls
DROP POLICY IF EXISTS "Internal full access ctm_calls" ON public.ctm_calls;
DROP POLICY IF EXISTS "Viewer can select assigned ctm_calls" ON public.ctm_calls;
CREATE POLICY "read ctm_calls" ON public.ctm_calls FOR SELECT
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "super admin write ctm_calls" ON public.ctm_calls FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- daily_metrics
DROP POLICY IF EXISTS "Internal full access daily_metrics" ON public.daily_metrics;
DROP POLICY IF EXISTS "Viewer can read assigned daily_metrics" ON public.daily_metrics;
CREATE POLICY "read daily_metrics" ON public.daily_metrics FOR SELECT
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "super admin write daily_metrics" ON public.daily_metrics FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- ghl_appointments
DROP POLICY IF EXISTS "ghl_appointments internal write" ON public.ghl_appointments;
CREATE POLICY "ghl_appointments super admin write" ON public.ghl_appointments FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- ghl_contacts
DROP POLICY IF EXISTS "Internal full access ghl_contacts" ON public.ghl_contacts;
DROP POLICY IF EXISTS "Viewers read assigned ghl_contacts" ON public.ghl_contacts;
CREATE POLICY "read ghl_contacts" ON public.ghl_contacts FOR SELECT
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "super admin write ghl_contacts" ON public.ghl_contacts FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- ghl_events_raw
DROP POLICY IF EXISTS "Internal full access ghl_events_raw" ON public.ghl_events_raw;
DROP POLICY IF EXISTS "Viewers read assigned ghl_events_raw" ON public.ghl_events_raw;
CREATE POLICY "read ghl_events_raw" ON public.ghl_events_raw FOR SELECT
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "super admin write ghl_events_raw" ON public.ghl_events_raw FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- ghl_lead_facts
DROP POLICY IF EXISTS "ghl_lead_facts internal write" ON public.ghl_lead_facts;
CREATE POLICY "ghl_lead_facts super admin write" ON public.ghl_lead_facts FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- ghl_messages
DROP POLICY IF EXISTS "ghl_messages internal write" ON public.ghl_messages;
CREATE POLICY "ghl_messages super admin write" ON public.ghl_messages FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- ghl_opportunities
DROP POLICY IF EXISTS "ghl_opportunities internal write" ON public.ghl_opportunities;
CREATE POLICY "ghl_opportunities super admin write" ON public.ghl_opportunities FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- ghl_opportunity_stage_history
DROP POLICY IF EXISTS "ghl_opp_history internal write" ON public.ghl_opportunity_stage_history;
CREATE POLICY "ghl_opp_history super admin write" ON public.ghl_opportunity_stage_history FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- ghl_pipeline_stages
DROP POLICY IF EXISTS "ghl_pipeline_stages internal write" ON public.ghl_pipeline_stages;
CREATE POLICY "ghl_pipeline_stages super admin write" ON public.ghl_pipeline_stages FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- ghl_pipelines
DROP POLICY IF EXISTS "ghl_pipelines internal write" ON public.ghl_pipelines;
CREATE POLICY "ghl_pipelines super admin write" ON public.ghl_pipelines FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- ghl_tasks
DROP POLICY IF EXISTS "ghl_tasks internal write" ON public.ghl_tasks;
CREATE POLICY "ghl_tasks super admin write" ON public.ghl_tasks FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- ghl_users
DROP POLICY IF EXISTS "ghl_users internal write" ON public.ghl_users;
CREATE POLICY "ghl_users super admin write" ON public.ghl_users FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- keyword_rankings
DROP POLICY IF EXISTS "Internal manages keyword_rankings" ON public.keyword_rankings;
DROP POLICY IF EXISTS "Viewer reads assigned keyword_rankings" ON public.keyword_rankings;
CREATE POLICY "read keyword_rankings" ON public.keyword_rankings FOR SELECT
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "super admin write keyword_rankings" ON public.keyword_rankings FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- keyword_share_of_voice
DROP POLICY IF EXISTS "Internal manages sov" ON public.keyword_share_of_voice;
DROP POLICY IF EXISTS "Viewer reads assigned sov" ON public.keyword_share_of_voice;
CREATE POLICY "read sov" ON public.keyword_share_of_voice FOR SELECT
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "super admin write sov" ON public.keyword_share_of_voice FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- lead_perf_suppression_tags
DROP POLICY IF EXISTS "suppression tags internal write" ON public.lead_perf_suppression_tags;
CREATE POLICY "suppression tags super admin write" ON public.lead_perf_suppression_tags FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- properties
DROP POLICY IF EXISTS "Internal can delete properties" ON public.properties;
DROP POLICY IF EXISTS "Internal can insert properties" ON public.properties;
DROP POLICY IF EXISTS "Internal can select all properties" ON public.properties;
DROP POLICY IF EXISTS "Internal can update properties" ON public.properties;
DROP POLICY IF EXISTS "Viewer can select assigned properties" ON public.properties;
CREATE POLICY "read properties" ON public.properties FOR SELECT
  USING (public.can_access_property(auth.uid(), id));
CREATE POLICY "super admin insert properties" ON public.properties FOR INSERT
  WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY "super admin update properties" ON public.properties FOR UPDATE
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY "super admin delete properties" ON public.properties FOR DELETE
  USING (public.is_super_admin(auth.uid()));

-- property_business_hours
DROP POLICY IF EXISTS "property_hours internal write" ON public.property_business_hours;
CREATE POLICY "property_hours super admin write" ON public.property_business_hours FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- property_call_score_mappings
DROP POLICY IF EXISTS "Internal manages score mappings" ON public.property_call_score_mappings;
DROP POLICY IF EXISTS "Viewer reads assigned score mappings" ON public.property_call_score_mappings;
CREATE POLICY "read score mappings" ON public.property_call_score_mappings FOR SELECT
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "super admin write score mappings" ON public.property_call_score_mappings FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- property_data_sources (staff read; super admin write)
DROP POLICY IF EXISTS "Internal full access data sources" ON public.property_data_sources;
CREATE POLICY "staff read data sources" ON public.property_data_sources FOR SELECT
  USING (public.is_staff(auth.uid()));
CREATE POLICY "super admin write data sources" ON public.property_data_sources FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- property_pipeline_mapping
DROP POLICY IF EXISTS "property_pipeline_mapping internal write" ON public.property_pipeline_mapping;
CREATE POLICY "property_pipeline_mapping super admin write" ON public.property_pipeline_mapping FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- property_settings
DROP POLICY IF EXISTS "Internal manages property_settings" ON public.property_settings;
DROP POLICY IF EXISTS "Viewer reads assigned property_settings" ON public.property_settings;
CREATE POLICY "read property_settings" ON public.property_settings FOR SELECT
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "super admin write property_settings" ON public.property_settings FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- property_sla_settings
DROP POLICY IF EXISTS "property_sla internal write" ON public.property_sla_settings;
CREATE POLICY "property_sla super admin write" ON public.property_sla_settings FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- property_targets
DROP POLICY IF EXISTS "internal manage property_targets" ON public.property_targets;
DROP POLICY IF EXISTS "viewers read accessible property_targets" ON public.property_targets;
CREATE POLICY "read property_targets" ON public.property_targets FOR SELECT
  USING (public.can_access_property(auth.uid(), property_id));
CREATE POLICY "super admin write property_targets" ON public.property_targets FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- sync_runs (staff read; super admin write)
DROP POLICY IF EXISTS "Internal manages sync_runs" ON public.sync_runs;
CREATE POLICY "staff read sync_runs" ON public.sync_runs FOR SELECT
  USING (public.is_all_properties_reader(auth.uid()));
CREATE POLICY "super admin write sync_runs" ON public.sync_runs FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- user_roles (super admin can manage; users read own)
DROP POLICY IF EXISTS "Internal can delete roles" ON public.user_roles;
DROP POLICY IF EXISTS "Internal can insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "Internal can read all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Internal can update roles" ON public.user_roles;
CREATE POLICY "super admin read all roles" ON public.user_roles FOR SELECT
  USING (public.is_super_admin(auth.uid()));
CREATE POLICY "super admin insert roles" ON public.user_roles FOR INSERT
  WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY "super admin update roles" ON public.user_roles FOR UPDATE
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY "super admin delete roles" ON public.user_roles FOR DELETE
  USING (public.is_super_admin(auth.uid()));

-- viewer_property_access (super admin manages; user reads own)
DROP POLICY IF EXISTS "Internal full access viewer assignments" ON public.viewer_property_access;
CREATE POLICY "super admin write viewer assignments" ON public.viewer_property_access FOR ALL
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));