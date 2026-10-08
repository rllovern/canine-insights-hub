CREATE SCHEMA mops;
REVOKE ALL ON SCHEMA mops FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA mops TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA mops REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA mops REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA mops REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;

CREATE TABLE mops.access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_reason text,
  revoked_at timestamptz,
  revoked_reason text
);
CREATE UNIQUE INDEX one_active_grant ON mops.access_grants ((true)) WHERE revoked_at IS NULL;

CREATE TABLE mops.audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor uuid,
  actor_label text,
  endpoint text,
  op text,
  target text,
  outcome text NOT NULL CHECK (outcome IN ('allowed','denied','error','system')),
  detail jsonb
);
CREATE INDEX audit_log_at_idx ON mops.audit_log (at DESC);

CREATE TABLE mops.client_lifecycle (
  property_id uuid PRIMARY KEY REFERENCES public.properties(id) ON DELETE CASCADE,
  classification text NOT NULL DEFAULT 'onboarding' CHECK (classification IN ('legacy','onboarding')),
  stage text NOT NULL DEFAULT 'questionnaire' CHECK (stage IN ('questionnaire','access_discovery','configuration','validation','active','paused','archived')),
  questionnaire_status text NOT NULL DEFAULT 'not_sent' CHECK (questionnaire_status IN ('unknown','not_sent','sent','in_progress','submitted')),
  questionnaire_submitted_at timestamptz,
  ads_control text NOT NULL DEFAULT 'unknown' CHECK (ads_control IN ('unknown','corporate','franchisee','prior_agency','other')),
  manager_linked text NOT NULL DEFAULT 'unknown' CHECK (manager_linked IN ('unknown','yes','no')),
  billing_responsibility text NOT NULL DEFAULT 'franchisee' CHECK (billing_responsibility IN ('franchisee','corporate','unknown')),
  billing_status text NOT NULL DEFAULT 'unknown' CHECK (billing_status IN ('unknown','not_set_up','pending','active','problem')),
  management_responsibility text NOT NULL DEFAULT 'corporate' CHECK (management_responsibility IN ('corporate','franchisee','shared','unknown')),
  last_activity_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mops.prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  city text, state text, contact_name text, contact_email text,
  notes text,
  status text NOT NULL DEFAULT 'prospect' CHECK (status IN ('prospect','converted','dropped')),
  converted_property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mops.requirement_catalog (
  key text PRIMARY KEY,
  area text NOT NULL,
  title text NOT NULL,
  sort int NOT NULL DEFAULT 0,
  verification text NOT NULL DEFAULT 'manual' CHECK (verification IN ('auto','detect_confirm','manual','conditional')),
  instructions text,
  source_needed boolean NOT NULL DEFAULT true
);

CREATE TABLE mops.client_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  req_key text NOT NULL REFERENCES mops.requirement_catalog(key),
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','awaiting_access','in_progress','awaiting_verification','verified','blocked','not_applicable')),
  severity text NOT NULL DEFAULT 'blocking' CHECK (severity IN ('blocking','warning')),
  note text,
  evidence jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, req_key)
);

CREATE TABLE mops.requirement_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  req_key text NOT NULL REFERENCES mops.requirement_catalog(key),
  resolution text NOT NULL,
  reason text,
  decided_by uuid,
  decided_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mops.client_assets (
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('google_ads','ga4','gtm','search_console','gbp','website','ctm','ghl')),
  exists_state text NOT NULL DEFAULT 'unknown' CHECK (exists_state IN ('yes','no','unknown','not_applicable')),
  controlled_by text NOT NULL DEFAULT 'unknown' CHECK (controlled_by IN ('corporate','franchisee','prior_agency','other','unknown')),
  access_status text NOT NULL DEFAULT 'unknown' CHECK (access_status IN ('unknown','needed','requested','granted','verified','create_new','not_applicable')),
  external_id text,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, platform)
);

CREATE TABLE mops.form_integration_config (
  property_id uuid PRIMARY KEY REFERENCES public.properties(id) ON DELETE CASCADE,
  thank_you_slug text, form_reactor_id text, tracking_number text, capture_host text, default_form text,
  snippet_installed boolean NOT NULL DEFAULT false,
  redirect_configured boolean NOT NULL DEFAULT false,
  thank_you_exists boolean NOT NULL DEFAULT false,
  form_reactor_configured boolean NOT NULL DEFAULT false,
  e2e_status text NOT NULL DEFAULT 'untested' CHECK (e2e_status IN ('untested','passed','failed')),
  last_verified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mops.journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX journal_prop_idx ON mops.journal_entries (property_id, created_at DESC);

CREATE TABLE mops.journal_revisions (
  id bigserial PRIMARY KEY,
  entry_id uuid NOT NULL REFERENCES mops.journal_entries(id),
  body text NOT NULL,
  revised_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mops.ads_change_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id text NOT NULL,
  change_time timestamptz NOT NULL,
  resource_name text NOT NULL,
  operation text NOT NULL DEFAULT '',
  resource_type text,
  scope text NOT NULL CHECK (scope IN ('campaign','account')),
  campaign_id text, campaign_name text, ad_group_name text,
  property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  user_email text, client_type text, changed_fields text,
  raw jsonb,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, resource_name, change_time, operation)
);
CREATE INDEX ads_change_prop_idx ON mops.ads_change_events (property_id, change_time DESC);
CREATE INDEX ads_change_cust_idx ON mops.ads_change_events (customer_id, change_time DESC);

CREATE TABLE mops.ads_change_sync_state (
  customer_id text PRIMARY KEY,
  last_success_through timestamptz,
  last_attempt_at timestamptz,
  consecutive_failures int NOT NULL DEFAULT 0,
  last_error text,
  gap_note text
);

CREATE TABLE mops.note_event_links (
  entry_id uuid NOT NULL REFERENCES mops.journal_entries(id),
  event_id uuid NOT NULL REFERENCES mops.ads_change_events(id),
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entry_id, event_id)
);

CREATE TABLE mops.ops_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  signal_key text NOT NULL,
  state text NOT NULL CHECK (state IN ('observing','action_required')),
  reason text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE UNIQUE INDEX ops_signals_open_uq ON mops.ops_signals (property_id, signal_key) WHERE resolved_at IS NULL;

CREATE TABLE mops.ai_usage (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor uuid NOT NULL,
  property_id uuid,
  chars int NOT NULL DEFAULT 0
);

REVOKE ALL ON ALL TABLES IN SCHEMA mops FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA mops FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA mops TO service_role;
REVOKE UPDATE ON mops.audit_log, mops.journal_revisions, mops.ads_change_events, mops.access_grants FROM service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA mops TO service_role;

ALTER TABLE mops.access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE mops.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE mops.client_lifecycle ENABLE ROW LEVEL SECURITY;
ALTER TABLE mops.prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE mops.requirement_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE mops.client_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE mops.requirement_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mops.client_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE mops.form_integration_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE mops.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE mops.journal_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mops.ads_change_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE mops.ads_change_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE mops.note_event_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE mops.ops_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE mops.ai_usage ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION mops.block_change() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'Records in % are protected from %', TG_TABLE_NAME, TG_OP; END $$;
CREATE TRIGGER audit_log_protect BEFORE UPDATE OR DELETE ON mops.audit_log FOR EACH ROW EXECUTE FUNCTION mops.block_change();
CREATE TRIGGER journal_rev_protect BEFORE UPDATE OR DELETE ON mops.journal_revisions FOR EACH ROW EXECUTE FUNCTION mops.block_change();
CREATE TRIGGER ads_change_protect BEFORE UPDATE OR DELETE ON mops.ads_change_events FOR EACH ROW EXECUTE FUNCTION mops.block_change();
CREATE TRIGGER journal_no_delete BEFORE DELETE ON mops.journal_entries FOR EACH ROW EXECUTE FUNCTION mops.block_change();
CREATE TRIGGER grants_no_delete BEFORE DELETE ON mops.access_grants FOR EACH ROW EXECUTE FUNCTION mops.block_change();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON mops.audit_log EXECUTE FUNCTION mops.block_change();
CREATE TRIGGER ads_change_no_truncate BEFORE TRUNCATE ON mops.ads_change_events EXECUTE FUNCTION mops.block_change();
CREATE TRIGGER journal_rev_no_truncate BEFORE TRUNCATE ON mops.journal_revisions EXECUTE FUNCTION mops.block_change();

CREATE FUNCTION mops.journal_keep_revision() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.body IS DISTINCT FROM OLD.body THEN
    INSERT INTO mops.journal_revisions (entry_id, body) VALUES (OLD.id, OLD.body);
    NEW.updated_at := now();
  END IF;
  NEW.created_at := OLD.created_at;
  NEW.property_id := OLD.property_id;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_revision BEFORE UPDATE ON mops.journal_entries FOR EACH ROW EXECUTE FUNCTION mops.journal_keep_revision();

CREATE FUNCTION mops.enforce_prerequisite() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE l record;
BEGIN
  SELECT classification, questionnaire_submitted_at INTO l FROM mops.client_lifecycle WHERE property_id = NEW.property_id;
  IF l.classification = 'onboarding' AND l.questionnaire_submitted_at IS NULL
     AND NEW.status NOT IN ('not_started','not_applicable') THEN
    RAISE EXCEPTION 'Onboarding steps unlock after the questionnaire is submitted';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER requirements_prereq BEFORE INSERT OR UPDATE ON mops.client_requirements FOR EACH ROW EXECUTE FUNCTION mops.enforce_prerequisite();

CREATE FUNCTION mops.check_grant(_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT _uid IS NOT NULL AND EXISTS (SELECT 1 FROM mops.access_grants WHERE user_id = _uid AND revoked_at IS NULL)
$$;
REVOKE ALL ON FUNCTION mops.check_grant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mops.check_grant(uuid) TO service_role;

CREATE FUNCTION public.mops_my_access() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM mops.access_grants WHERE user_id = auth.uid() AND revoked_at IS NULL)
$$;
REVOKE ALL ON FUNCTION public.mops_my_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mops_my_access() TO authenticated;

CREATE FUNCTION mops.recover_access(_new_user uuid, _reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old_uid uuid;
BEGIN
  IF _reason IS NULL OR length(trim(_reason)) < 5 THEN RAISE EXCEPTION 'A recovery reason/ticket reference is required'; END IF;
  SELECT user_id INTO old_uid FROM mops.access_grants WHERE revoked_at IS NULL;
  UPDATE mops.access_grants SET revoked_at = now(), revoked_reason = _reason WHERE revoked_at IS NULL;
  INSERT INTO mops.audit_log (actor, actor_label, op, target, outcome, detail)
    VALUES (old_uid, 'infrastructure-admin', 'access_revoked', old_uid::text, 'system', jsonb_build_object('reason', _reason));
  INSERT INTO mops.access_grants (user_id, granted_reason) VALUES (_new_user, _reason);
  INSERT INTO mops.audit_log (actor, actor_label, op, target, outcome, detail)
    VALUES (_new_user, 'infrastructure-admin', 'access_granted', _new_user::text, 'system', jsonb_build_object('reason', _reason));
END $$;
REVOKE ALL ON FUNCTION mops.recover_access(uuid, text) FROM PUBLIC, anon, service_role;

INSERT INTO mops.requirement_catalog (key, area, title, sort, verification, source_needed) VALUES
 ('access_google_ads','access','Google Ads access',10,'auto',false),
 ('access_ga4','access','Google Analytics 4 access',11,'manual',false),
 ('access_gtm','access','Google Tag Manager access',12,'manual',false),
 ('access_search_console','access','Search Console access',13,'manual',false),
 ('access_gbp','access','Google Business Profile access',14,'manual',false),
 ('access_website','access','Website / CMS access',15,'manual',false),
 ('access_ctm','access','CallTrackingMetrics account',16,'auto',false),
 ('access_ghl','access','GoHighLevel connection',17,'auto',false),
 ('gads_build_sheet','google_ads','A. PPC build sheet',20,'manual',true),
 ('gads_gbp_link','google_ads','B. Google Ads and Business Profile integration',21,'manual',true),
 ('gads_search_console','google_ads','C. Search Console integration',22,'manual',true),
 ('gads_ga4','google_ads','D. GA4 integration',23,'manual',true),
 ('gads_ctm','google_ads','E. CallTrackingMetrics integration',24,'detect_confirm',true),
 ('gads_conversions','google_ads','F. Custom conversion actions',25,'manual',true),
 ('gads_conversion_eval','google_ads','G. Conversion action evaluation',26,'manual',true),
 ('gads_negatives','google_ads','H. Agency-level negative keywords',27,'manual',true),
 ('gads_suitability','google_ads','I. Content suitability',28,'manual',true),
 ('gads_budget','google_ads','J. Budget monitoring',29,'auto',true),
 ('gads_position_rule','google_ads','K. Agency-level position increase rule',30,'conditional',true),
 ('gads_kickoff','google_ads','L. Kickoff call',31,'manual',true),
 ('ctm_website','ctm','A. Website tracking',40,'manual',true),
 ('ctm_phone','ctm','B. Phone infrastructure',41,'manual',true),
 ('ctm_config','ctm','C. Call tracking configuration',42,'manual',true),
 ('ctm_scoring','ctm','D. Lead scoring',43,'manual',true),
 ('ctm_integrations','ctm','E. Platform integrations',44,'manual',true),
 ('ctm_forms','ctm','F. Forms',45,'manual',true),
 ('ctm_spam','ctm','G. Spam protection',46,'manual',true),
 ('ctm_handoff','ctm','H. Client handoff',47,'manual',true),
 ('ctm_testing','ctm','I. Testing',48,'auto',true),
 ('form_snippet','ghl_forms','GHL-to-CTM snippet installed',60,'manual',false),
 ('form_redirect','ghl_forms','GHL redirect configured',61,'manual',false),
 ('form_thankyou','ghl_forms','Thank-you page exists',62,'manual',false),
 ('form_reactor','ghl_forms','CTM FormReactor configured',63,'manual',false),
 ('form_e2e','ghl_forms','End-to-end form test',64,'manual',false),
 ('landing_page','website','Landing page decision',70,'manual',false),
 ('billing_active','billing','Franchisee Google Ads billing active',80,'manual',false);

CREATE FUNCTION mops.generate_requirements(_pid uuid, _answers jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO mops.client_assets (property_id, platform, exists_state, access_status, external_id)
  SELECT _pid, p.platform,
    CASE p.ans WHEN 'Yes' THEN 'yes' WHEN 'No' THEN 'no' ELSE 'unknown' END,
    CASE p.ans WHEN 'Yes' THEN 'needed' WHEN 'No' THEN 'create_new' ELSE 'unknown' END,
    p.ext
  FROM (VALUES
    ('google_ads', _answers->>'has_google_ads', _answers->>'google_ads_cid'),
    ('ga4', _answers->>'has_ga4', _answers->>'ga4_id'),
    ('gtm', _answers->>'has_gtm', _answers->>'gtm_id'),
    ('ctm', _answers->>'has_call_tracking', _answers->>'call_tracking_vendor'),
    ('ghl', _answers->>'has_crm', _answers->>'crm_name'),
    ('website', CASE WHEN coalesce(_answers->>'website_url','') <> '' THEN 'Yes' ELSE NULL END, _answers->>'website_url'),
    ('gbp', CASE WHEN coalesce(_answers->>'gbp_url','') <> '' THEN 'Yes' ELSE NULL END, _answers->>'gbp_url'),
    ('search_console', NULL, NULL)
  ) AS p(platform, ans, ext)
  ON CONFLICT (property_id, platform) DO NOTHING;

  INSERT INTO mops.client_requirements (property_id, req_key, status, severity, note)
  SELECT _pid, c.key, 'not_started',
    CASE WHEN c.area IN ('access','google_ads','ctm','billing') THEN 'blocking' ELSE 'warning' END,
    CASE
      WHEN c.key = 'access_google_ads' AND _answers->>'has_google_ads' = 'No' THEN 'No existing account: create under the corporate manager account.'
      WHEN c.key = 'access_google_ads' AND _answers->>'has_google_ads' = 'Not sure' THEN 'Ownership unknown: confirm with the client.'
      WHEN c.key = 'access_ga4' AND _answers->>'has_ga4' = 'No' THEN 'No existing property: create new.'
      WHEN c.key = 'access_gtm' AND _answers->>'has_gtm' = 'No' THEN 'No existing container: create new.'
      WHEN c.key = 'access_ctm' AND _answers->>'has_call_tracking' = 'Yes' THEN 'Client uses ' || coalesce(_answers->>'call_tracking_vendor','another vendor') || ': plan replacement with CTM.'
      ELSE NULL END
  FROM mops.requirement_catalog c
  ON CONFLICT (property_id, req_key) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION mops.generate_requirements(uuid, jsonb) FROM PUBLIC, anon, service_role;

CREATE FUNCTION mops.init_lifecycle() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  BEGIN
    INSERT INTO mops.client_lifecycle (property_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
    INSERT INTO mops.audit_log (actor_label, op, target, outcome) VALUES ('system:property_created', 'lifecycle_init', NEW.id::text, 'system');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION mops.init_lifecycle() FROM PUBLIC, anon, service_role;
CREATE TRIGGER mops_init_lifecycle AFTER INSERT ON public.properties FOR EACH ROW EXECUTE FUNCTION mops.init_lifecycle();

CREATE FUNCTION mops.on_invite() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  BEGIN
    IF NEW.property_id IS NOT NULL THEN
      INSERT INTO mops.client_lifecycle (property_id, questionnaire_status) VALUES (NEW.property_id, 'sent')
      ON CONFLICT (property_id) DO UPDATE SET questionnaire_status = 'sent', updated_at = now()
        WHERE mops.client_lifecycle.questionnaire_status = 'not_sent';
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION mops.on_invite() FROM PUBLIC, anon, service_role;
CREATE TRIGGER mops_on_invite AFTER INSERT ON public.onboarding_invites FOR EACH ROW EXECUTE FUNCTION mops.on_invite();

CREATE FUNCTION mops.on_submission() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pid uuid;
BEGIN
  BEGIN
    pid := NEW.property_id;
    IF pid IS NULL THEN SELECT property_id INTO pid FROM public.onboarding_invites WHERE id = NEW.invite_id; END IF;
    IF pid IS NOT NULL THEN
      IF NEW.status IN ('submitted','approved') AND NEW.submitted_at IS NOT NULL THEN
        INSERT INTO mops.client_lifecycle (property_id) VALUES (pid) ON CONFLICT DO NOTHING;
        UPDATE mops.client_lifecycle
          SET questionnaire_status = 'submitted',
              questionnaire_submitted_at = coalesce(questionnaire_submitted_at, NEW.submitted_at),
              stage = CASE WHEN stage = 'questionnaire' THEN 'access_discovery' ELSE stage END,
              last_activity_at = now(), updated_at = now()
          WHERE property_id = pid;
        PERFORM mops.generate_requirements(pid, NEW.answers);
        INSERT INTO mops.audit_log (actor_label, op, target, outcome) VALUES ('system:questionnaire', 'questionnaire_submitted', pid::text, 'system');
      ELSIF NEW.status = 'in_progress' THEN
        UPDATE mops.client_lifecycle SET questionnaire_status = 'in_progress', updated_at = now()
          WHERE property_id = pid AND questionnaire_status IN ('not_sent','sent');
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION mops.on_submission() FROM PUBLIC, anon, service_role;
CREATE TRIGGER mops_on_submission AFTER INSERT OR UPDATE OF status ON public.onboarding_submissions FOR EACH ROW EXECUTE FUNCTION mops.on_submission();

INSERT INTO mops.client_lifecycle (property_id, classification, stage, questionnaire_status)
SELECT id, 'legacy', CASE WHEN is_active THEN 'active' ELSE 'paused' END, 'unknown' FROM public.properties
ON CONFLICT DO NOTHING;

INSERT INTO mops.access_grants (user_id, granted_reason) VALUES ('5a69d56f-7ae2-421b-8220-c741491511ed', 'Initial designated Marketing Ops owner');
INSERT INTO mops.audit_log (actor, actor_label, op, target, outcome) VALUES ('5a69d56f-7ae2-421b-8220-c741491511ed', 'migration', 'access_granted', '5a69d56f-7ae2-421b-8220-c741491511ed', 'system');