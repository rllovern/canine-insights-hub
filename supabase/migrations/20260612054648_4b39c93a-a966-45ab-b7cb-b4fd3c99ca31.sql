
-- =====================================================================
-- Migration A — Lead Performance schema
-- =====================================================================

-- ---------- ENUMS ----------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.ghl_response_source AS ENUM ('human','automation','ai','system','unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ghl_opportunity_status AS ENUM ('open','won','lost','abandoned','unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ghl_appointment_status AS ENUM ('booked','confirmed','showed','no_show','cancelled','rescheduled','unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ghl_canonical_stage AS ENUM ('new','contacted','engaged','appointment','showed','won','lost','ignore');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ghl_stage_history_source AS ENUM ('sync_diff','webhook','manual_backfill');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- updated_at helper (idempotent) ---------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- ---------- shared RLS helper (read access) --------------------------
-- internal full, viewer read if assigned to property
CREATE OR REPLACE FUNCTION public.lead_perf_can_read(_user_id uuid, _property_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id, 'internal'::app_role)
      OR public.viewer_can_access(_user_id, _property_id)
$$;

-- =====================================================================
-- ghl_users
-- =====================================================================
CREATE TABLE public.ghl_users (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  ghl_user_id text NOT NULL,
  name text,
  email text,
  role text,
  is_active boolean NOT NULL DEFAULT true,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, ghl_user_id)
);
GRANT SELECT ON public.ghl_users TO authenticated;
GRANT ALL ON public.ghl_users TO service_role;
ALTER TABLE public.ghl_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ghl_users read" ON public.ghl_users FOR SELECT TO authenticated
  USING (public.lead_perf_can_read(auth.uid(), property_id));
CREATE POLICY "ghl_users internal write" ON public.ghl_users FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'internal'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'internal'::app_role));
CREATE INDEX ghl_users_property_idx ON public.ghl_users(property_id);
CREATE TRIGGER ghl_users_set_updated_at BEFORE UPDATE ON public.ghl_users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- ghl_pipelines + stages
-- =====================================================================
CREATE TABLE public.ghl_pipelines (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  ghl_pipeline_id text NOT NULL,
  name text,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, ghl_pipeline_id)
);
GRANT SELECT ON public.ghl_pipelines TO authenticated;
GRANT ALL ON public.ghl_pipelines TO service_role;
ALTER TABLE public.ghl_pipelines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ghl_pipelines read" ON public.ghl_pipelines FOR SELECT TO authenticated
  USING (public.lead_perf_can_read(auth.uid(), property_id));
CREATE POLICY "ghl_pipelines internal write" ON public.ghl_pipelines FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'internal'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'internal'::app_role));
CREATE INDEX ghl_pipelines_property_idx ON public.ghl_pipelines(property_id);
CREATE TRIGGER ghl_pipelines_set_updated_at BEFORE UPDATE ON public.ghl_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.ghl_pipeline_stages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  pipeline_id uuid NOT NULL REFERENCES public.ghl_pipelines(id) ON DELETE CASCADE,
  ghl_pipeline_id text NOT NULL,
  ghl_stage_id text NOT NULL,
  name text,
  position integer,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, ghl_stage_id)
);
GRANT SELECT ON public.ghl_pipeline_stages TO authenticated;
GRANT ALL ON public.ghl_pipeline_stages TO service_role;
ALTER TABLE public.ghl_pipeline_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ghl_pipeline_stages read" ON public.ghl_pipeline_stages FOR SELECT TO authenticated
  USING (public.lead_perf_can_read(auth.uid(), property_id));
CREATE POLICY "ghl_pipeline_stages internal write" ON public.ghl_pipeline_stages FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'internal'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'internal'::app_role));
CREATE INDEX ghl_pipeline_stages_property_idx ON public.ghl_pipeline_stages(property_id);
CREATE INDEX ghl_pipeline_stages_pipeline_idx ON public.ghl_pipeline_stages(pipeline_id);
CREATE TRIGGER ghl_pipeline_stages_set_updated_at BEFORE UPDATE ON public.ghl_pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- property_pipeline_mapping
-- Seeds are suggestions only; UI flips confirmed_by_user true when saved.
-- =====================================================================
CREATE TABLE public.property_pipeline_mapping (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  ghl_stage_id text NOT NULL,
  ghl_pipeline_id text,
  canonical_stage public.ghl_canonical_stage NOT NULL,
  suggested_canonical_stage public.ghl_canonical_stage,
  confirmed_by_user boolean NOT NULL DEFAULT false,
  confirmed_by uuid,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, ghl_stage_id)
);
GRANT SELECT ON public.property_pipeline_mapping TO authenticated;
GRANT ALL ON public.property_pipeline_mapping TO service_role;
ALTER TABLE public.property_pipeline_mapping ENABLE ROW LEVEL SECURITY;
CREATE POLICY "property_pipeline_mapping read" ON public.property_pipeline_mapping FOR SELECT TO authenticated
  USING (public.lead_perf_can_read(auth.uid(), property_id));
CREATE POLICY "property_pipeline_mapping internal write" ON public.property_pipeline_mapping FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'internal'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'internal'::app_role));
CREATE INDEX property_pipeline_mapping_property_idx ON public.property_pipeline_mapping(property_id);
CREATE TRIGGER property_pipeline_mapping_set_updated_at BEFORE UPDATE ON public.property_pipeline_mapping
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- ghl_messages
-- response_source classified at write time. Includes 'system' per probe delta.
-- =====================================================================
CREATE TABLE public.ghl_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  ghl_message_id text NOT NULL,
  conversation_id text,
  contact_id text,
  direction text,                 -- 'inbound' | 'outbound' | NULL
  channel text,                   -- sms | email | call | etc.
  message_type text,              -- raw TYPE_* from GHL
  ghl_user_id text,               -- nullable; null usually means non-human
  response_source public.ghl_response_source NOT NULL DEFAULT 'unknown',
  source_raw text,                -- raw GHL "source" string (workflow, campaign, bulk_actions, ...)
  sent_at timestamptz,
  body_preview text,
  meta jsonb,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, ghl_message_id)
);
GRANT SELECT ON public.ghl_messages TO authenticated;
GRANT ALL ON public.ghl_messages TO service_role;
ALTER TABLE public.ghl_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ghl_messages read" ON public.ghl_messages FOR SELECT TO authenticated
  USING (public.lead_perf_can_read(auth.uid(), property_id));
CREATE POLICY "ghl_messages internal write" ON public.ghl_messages FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'internal'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'internal'::app_role));
CREATE INDEX ghl_messages_property_idx ON public.ghl_messages(property_id);
CREATE INDEX ghl_messages_contact_idx ON public.ghl_messages(property_id, contact_id);
CREATE INDEX ghl_messages_sent_at_idx ON public.ghl_messages(property_id, sent_at);
CREATE INDEX ghl_messages_response_source_idx ON public.ghl_messages(property_id, response_source);
CREATE INDEX ghl_messages_user_idx ON public.ghl_messages(property_id, ghl_user_id);
CREATE TRIGGER ghl_messages_set_updated_at BEFORE UPDATE ON public.ghl_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- ghl_opportunities
-- 'abandoned' included per probe delta.
-- =====================================================================
CREATE TABLE public.ghl_opportunities (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  ghl_opportunity_id text NOT NULL,
  contact_id text,
  pipeline_id text,
  stage_id text,
  status public.ghl_opportunity_status NOT NULL DEFAULT 'unknown',
  status_raw text,
  monetary_value numeric,
  assigned_to text,                       -- ghl_user_id
  lost_reason_raw text,
  lost_reason_normalized text,
  won_at timestamptz,
  lost_at timestamptz,
  ghl_created_at timestamptz,
  ghl_updated_at timestamptz,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, ghl_opportunity_id)
);
GRANT SELECT ON public.ghl_opportunities TO authenticated;
GRANT ALL ON public.ghl_opportunities TO service_role;
ALTER TABLE public.ghl_opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ghl_opportunities read" ON public.ghl_opportunities FOR SELECT TO authenticated
  USING (public.lead_perf_can_read(auth.uid(), property_id));
CREATE POLICY "ghl_opportunities internal write" ON public.ghl_opportunities FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'internal'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'internal'::app_role));
CREATE INDEX ghl_opportunities_property_idx ON public.ghl_opportunities(property_id);
CREATE INDEX ghl_opportunities_contact_idx ON public.ghl_opportunities(property_id, contact_id);
CREATE INDEX ghl_opportunities_stage_idx ON public.ghl_opportunities(property_id, stage_id);
CREATE INDEX ghl_opportunities_assigned_idx ON public.ghl_opportunities(property_id, assigned_to);
CREATE INDEX ghl_opportunities_status_idx ON public.ghl_opportunities(property_id, status);
CREATE TRIGGER ghl_opportunities_set_updated_at BEFORE UPDATE ON public.ghl_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- ghl_opportunity_stage_history
-- =====================================================================
CREATE TABLE public.ghl_opportunity_stage_history (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES public.ghl_opportunities(id) ON DELETE CASCADE,
  from_stage_id text,
  to_stage_id text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  source public.ghl_stage_history_source NOT NULL DEFAULT 'sync_diff',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ghl_opportunity_stage_history TO authenticated;
GRANT ALL ON public.ghl_opportunity_stage_history TO service_role;
ALTER TABLE public.ghl_opportunity_stage_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ghl_opp_history read" ON public.ghl_opportunity_stage_history FOR SELECT TO authenticated
  USING (public.lead_perf_can_read(auth.uid(), property_id));
CREATE POLICY "ghl_opp_history internal write" ON public.ghl_opportunity_stage_history FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'internal'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'internal'::app_role));
CREATE INDEX ghl_opp_history_opp_idx ON public.ghl_opportunity_stage_history(opportunity_id, changed_at);
CREATE INDEX ghl_opp_history_property_idx ON public.ghl_opportunity_stage_history(property_id);

-- =====================================================================
-- ghl_appointments
-- appointment_status_raw stored verbatim; status_is_derived = true when
-- showed/no_show was inferred from confirmed + endTime < now().
-- =====================================================================
CREATE TABLE public.ghl_appointments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  ghl_event_id text NOT NULL,
  calendar_id text,
  contact_id text,
  opportunity_id text,
  assigned_user_id text,
  starts_at timestamptz,
  ends_at timestamptz,
  appointment_status public.ghl_appointment_status NOT NULL DEFAULT 'unknown',
  appointment_status_raw text,
  status_is_derived boolean NOT NULL DEFAULT false,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, ghl_event_id)
);
GRANT SELECT ON public.ghl_appointments TO authenticated;
GRANT ALL ON public.ghl_appointments TO service_role;
ALTER TABLE public.ghl_appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ghl_appointments read" ON public.ghl_appointments FOR SELECT TO authenticated
  USING (public.lead_perf_can_read(auth.uid(), property_id));
CREATE POLICY "ghl_appointments internal write" ON public.ghl_appointments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'internal'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'internal'::app_role));
CREATE INDEX ghl_appointments_property_idx ON public.ghl_appointments(property_id);
CREATE INDEX ghl_appointments_contact_idx ON public.ghl_appointments(property_id, contact_id);
CREATE INDEX ghl_appointments_opp_idx ON public.ghl_appointments(property_id, opportunity_id);
CREATE INDEX ghl_appointments_assigned_idx ON public.ghl_appointments(property_id, assigned_user_id);
CREATE INDEX ghl_appointments_starts_at_idx ON public.ghl_appointments(property_id, starts_at);
CREATE TRIGGER ghl_appointments_set_updated_at BEFORE UPDATE ON public.ghl_appointments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- ghl_tasks
-- =====================================================================
CREATE TABLE public.ghl_tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  ghl_task_id text NOT NULL,
  contact_id text,
  assigned_user_id text,
  status text,
  task_type text,
  title text,
  due_at timestamptz,
  completed_at timestamptz,
  counts_as_attempt boolean NOT NULL DEFAULT false,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, ghl_task_id)
);
GRANT SELECT ON public.ghl_tasks TO authenticated;
GRANT ALL ON public.ghl_tasks TO service_role;
ALTER TABLE public.ghl_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ghl_tasks read" ON public.ghl_tasks FOR SELECT TO authenticated
  USING (public.lead_perf_can_read(auth.uid(), property_id));
CREATE POLICY "ghl_tasks internal write" ON public.ghl_tasks FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'internal'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'internal'::app_role));
CREATE INDEX ghl_tasks_property_idx ON public.ghl_tasks(property_id);
CREATE INDEX ghl_tasks_contact_idx ON public.ghl_tasks(property_id, contact_id);
CREATE INDEX ghl_tasks_assigned_idx ON public.ghl_tasks(property_id, assigned_user_id);
CREATE TRIGGER ghl_tasks_set_updated_at BEFORE UPDATE ON public.ghl_tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- agency_sla_defaults (single-row config)
-- =====================================================================
CREATE TABLE public.agency_sla_defaults (
  id boolean NOT NULL PRIMARY KEY DEFAULT true CHECK (id),
  first_response_seconds integer NOT NULL DEFAULT 300,
  attempts_24h integer NOT NULL DEFAULT 3,
  attempts_7d integer NOT NULL DEFAULT 5,
  stale_after_hours integer NOT NULL DEFAULT 24,
  critical_stale_after_hours integer NOT NULL DEFAULT 48,
  business_hours_only boolean NOT NULL DEFAULT true,
  after_hours_mode text NOT NULL DEFAULT 'pause_until_open'
    CHECK (after_hours_mode IN ('count_raw','pause_until_open','exclude_from_sla','report_separately')),
  active_window_days integer NOT NULL DEFAULT 30,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.agency_sla_defaults TO authenticated;
GRANT ALL ON public.agency_sla_defaults TO service_role;
ALTER TABLE public.agency_sla_defaults ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agency_sla read" ON public.agency_sla_defaults FOR SELECT TO authenticated USING (true);
CREATE POLICY "agency_sla internal write" ON public.agency_sla_defaults FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'internal'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'internal'::app_role));
CREATE TRIGGER agency_sla_set_updated_at BEFORE UPDATE ON public.agency_sla_defaults
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
INSERT INTO public.agency_sla_defaults (id) VALUES (true) ON CONFLICT DO NOTHING;

-- =====================================================================
-- property_sla_settings
-- =====================================================================
CREATE TABLE public.property_sla_settings (
  property_id uuid NOT NULL PRIMARY KEY REFERENCES public.properties(id) ON DELETE CASCADE,
  first_response_seconds integer,
  attempts_24h integer,
  attempts_7d integer,
  stale_after_hours integer,
  critical_stale_after_hours integer,
  business_hours_only boolean,
  after_hours_mode text
    CHECK (after_hours_mode IS NULL OR after_hours_mode IN ('count_raw','pause_until_open','exclude_from_sla','report_separately')),
  timezone text,
  active_window_days integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.property_sla_settings TO authenticated;
GRANT ALL ON public.property_sla_settings TO service_role;
ALTER TABLE public.property_sla_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "property_sla read" ON public.property_sla_settings FOR SELECT TO authenticated
  USING (public.lead_perf_can_read(auth.uid(), property_id));
CREATE POLICY "property_sla internal write" ON public.property_sla_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'internal'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'internal'::app_role));
CREATE TRIGGER property_sla_set_updated_at BEFORE UPDATE ON public.property_sla_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- property_business_hours
-- =====================================================================
CREATE TABLE public.property_business_hours (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  opens_at time,
  closes_at time,
  is_closed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, day_of_week)
);
GRANT SELECT ON public.property_business_hours TO authenticated;
GRANT ALL ON public.property_business_hours TO service_role;
ALTER TABLE public.property_business_hours ENABLE ROW LEVEL SECURITY;
CREATE POLICY "property_hours read" ON public.property_business_hours FOR SELECT TO authenticated
  USING (public.lead_perf_can_read(auth.uid(), property_id));
CREATE POLICY "property_hours internal write" ON public.property_business_hours FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'internal'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'internal'::app_role));
CREATE TRIGGER property_hours_set_updated_at BEFORE UPDATE ON public.property_business_hours
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- ghl_lead_facts — primary reporting table
-- One row per lead lifecycle instance (a contact can have several).
-- =====================================================================
CREATE TABLE public.ghl_lead_facts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  contact_id text NOT NULL,
  opportunity_id text,
  assigned_user_id text,
  pipeline_id text,
  stage_id text,
  canonical_stage public.ghl_canonical_stage,

  lead_created_at timestamptz NOT NULL,

  first_any_response_at timestamptz,
  first_human_response_at timestamptz,
  first_automation_response_at timestamptz,
  first_ai_response_at timestamptz,
  first_human_response_channel text,

  human_speed_to_lead_seconds_raw integer,
  human_speed_to_lead_seconds_business integer,

  human_attempt_count integer NOT NULL DEFAULT 0,
  automation_touch_count integer NOT NULL DEFAULT 0,
  ai_touch_count integer NOT NULL DEFAULT 0,
  total_touch_count integer NOT NULL DEFAULT 0,

  appointment_booked_at timestamptz,
  appointment_showed_at timestamptz,
  appointment_no_show_at timestamptz,

  won_at timestamptz,
  lost_at timestamptz,
  lost_reason_raw text,
  lost_reason_normalized text,
  monetary_value numeric,

  is_open boolean NOT NULL DEFAULT true,
  is_stale boolean NOT NULL DEFAULT false,
  last_human_activity_at timestamptz,
  last_activity_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, contact_id, opportunity_id)
);
GRANT SELECT ON public.ghl_lead_facts TO authenticated;
GRANT ALL ON public.ghl_lead_facts TO service_role;
ALTER TABLE public.ghl_lead_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ghl_lead_facts read" ON public.ghl_lead_facts FOR SELECT TO authenticated
  USING (public.lead_perf_can_read(auth.uid(), property_id));
CREATE POLICY "ghl_lead_facts internal write" ON public.ghl_lead_facts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'internal'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'internal'::app_role));
CREATE INDEX ghl_lead_facts_property_idx ON public.ghl_lead_facts(property_id);
CREATE INDEX ghl_lead_facts_property_created_idx ON public.ghl_lead_facts(property_id, lead_created_at DESC);
CREATE INDEX ghl_lead_facts_assigned_idx ON public.ghl_lead_facts(property_id, assigned_user_id);
CREATE INDEX ghl_lead_facts_stage_idx ON public.ghl_lead_facts(property_id, canonical_stage);
CREATE INDEX ghl_lead_facts_open_idx ON public.ghl_lead_facts(property_id, is_open);
CREATE INDEX ghl_lead_facts_stale_idx ON public.ghl_lead_facts(property_id, is_stale);
CREATE INDEX ghl_lead_facts_contact_idx ON public.ghl_lead_facts(property_id, contact_id);
CREATE TRIGGER ghl_lead_facts_set_updated_at BEFORE UPDATE ON public.ghl_lead_facts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- Extend ghl_contacts with convenience columns
-- =====================================================================
ALTER TABLE public.ghl_contacts
  ADD COLUMN IF NOT EXISTS first_human_response_at timestamptz,
  ADD COLUMN IF NOT EXISTS latest_human_response_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_user_id text,
  ADD COLUMN IF NOT EXISTS has_opportunity boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS latest_opportunity_id text,
  ADD COLUMN IF NOT EXISTS duplicate_group_id text;

CREATE INDEX IF NOT EXISTS ghl_contacts_assigned_idx ON public.ghl_contacts(property_id, assigned_user_id);
CREATE INDEX IF NOT EXISTS ghl_contacts_duplicate_idx ON public.ghl_contacts(property_id, duplicate_group_id);
