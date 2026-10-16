ALTER TABLE mops.form_sync_config
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'off' CHECK (mode IN ('off','monitor','live')),
  ADD COLUMN IF NOT EXISTS manual_hold boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_hold_reason text,
  ADD COLUMN IF NOT EXISTS readiness text,
  ADD COLUMN IF NOT EXISTS matching_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS preflight_status text,
  ADD COLUMN IF NOT EXISTS preflight_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS preflight_at timestamptz,
  ADD COLUMN IF NOT EXISTS preflight_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS call_expectation text NOT NULL DEFAULT 'unverified' CHECK (call_expectation IN ('expected','not_expected','unverified')),
  ADD COLUMN IF NOT EXISTS call_expectation_note text;

ALTER TABLE mops.form_sync_submissions ADD COLUMN IF NOT EXISTS alerted_review_at timestamptz;

-- DFW keeps its live setup.
UPDATE mops.form_sync_config SET mode = 'live', readiness = 'validated_live', matching_verified = true, preflight_status = 'passed'
WHERE property_id = 'cbd7adea-bed7-4b2a-ab71-69194fe9fc62';

CREATE TABLE mops.recon_forms (
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  ghl_form_id text NOT NULL,
  name text,
  classification text NOT NULL DEFAULT 'unclassified' CHECK (classification IN ('inquiry','operational','unclassified')),
  classification_source text NOT NULL DEFAULT 'auto' CHECK (classification_source IN ('auto','manual')),
  form_source text,
  ctm_form_name text,
  message_key text,
  message_key_candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  submissions_30d int NOT NULL DEFAULT 0,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid, reviewed_at timestamptz,
  PRIMARY KEY (property_id, ghl_form_id)
);

INSERT INTO mops.recon_forms (property_id, ghl_form_id, name, classification, classification_source, form_source, ctm_form_name, message_key, reviewed_at)
SELECT c.property_id, f.key, f.value->>'label', 'inquiry', 'manual', f.value->>'form_source', f.value->>'form_name', c.ghl_message_key, now()
FROM mops.form_sync_config c, jsonb_each(c.form_map) f
WHERE c.property_id = 'cbd7adea-bed7-4b2a-ab71-69194fe9fc62';

CREATE TABLE mops.recon_preflight_runs (
  id bigserial PRIMARY KEY,
  property_id uuid NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  actor uuid,
  outcome text NOT NULL,
  mode_before text, mode_after text,
  checks jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX ON mops.recon_preflight_runs (property_id, at DESC);
CREATE TRIGGER recon_preflight_protect BEFORE UPDATE OR DELETE ON mops.recon_preflight_runs FOR EACH ROW EXECUTE FUNCTION mops.block_change();

CREATE TABLE mops.recon_call_discrepancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  ctm_call_id text NOT NULL,
  called_at timestamptz NOT NULL,
  caller_masked text,
  kind text NOT NULL DEFAULT 'call_missing_in_ghl',
  expectation text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  alerted_at timestamptz,
  UNIQUE (property_id, ctm_call_id, kind)
);
CREATE INDEX ON mops.recon_call_discrepancies (property_id, status, called_at DESC);

CREATE TABLE mops.recon_runtime (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_scheduled_run_at timestamptz,
  last_calls_check_at timestamptz,
  lease_until timestamptz
);
INSERT INTO mops.recon_runtime (id) VALUES (1);

CREATE TABLE mops.recon_alert_state (
  key text PRIMARY KEY,
  state text,
  alerted_at timestamptz
);

ALTER TABLE mops.recon_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE mops.recon_preflight_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mops.recon_call_discrepancies ENABLE ROW LEVEL SECURITY;
ALTER TABLE mops.recon_runtime ENABLE ROW LEVEL SECURITY;
ALTER TABLE mops.recon_alert_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mops.recon_forms, mops.recon_preflight_runs, mops.recon_call_discrepancies, mops.recon_runtime, mops.recon_alert_state FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE mops.recon_preflight_runs_id_seq FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION mops.recon_rebuild_form_map(_pid uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE mops.form_sync_config SET form_map = coalesce((
    SELECT jsonb_object_agg(f.ghl_form_id, jsonb_build_object('form_name', coalesce(f.ctm_form_name, f.name), 'form_source', f.form_source, 'label', f.name, 'message_key', f.message_key))
    FROM mops.recon_forms f WHERE f.property_id = _pid AND f.classification = 'inquiry' AND f.form_source IS NOT NULL AND f.message_key IS NOT NULL), '{}'::jsonb),
    updated_at = now()
  WHERE property_id = _pid;
$$;
REVOKE ALL ON FUNCTION mops.recon_rebuild_form_map(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION mops.recon_core(_actor uuid, _op text, _args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  pid uuid := nullif(_args->>'property_id','')::uuid;
  cfg mops.form_sync_config; it jsonb; mb text; ma text; st text; ok boolean; res jsonb; n int;
BEGIN
  IF _op = 'formsync_recon_candidates' THEN
    -- Active locations connected to both GHL and CTM, with their current control state.
    RETURN jsonb_build_object('locations', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'property_id', p.id, 'property_name', p.name,
      'ghl_status', g.status, 'ctm_status', t.status,
      'has_config', c.property_id IS NOT NULL, 'mode', coalesce(c.mode,'off'), 'manual_hold', coalesce(c.manual_hold,false),
      'preflight_at', c.preflight_at, 'preflight_requested', coalesce(c.preflight_requested,false)) ORDER BY c.preflight_at NULLS FIRST), '[]'::jsonb)
      FROM public.properties p
      JOIN public.property_data_sources g ON g.property_id = p.id AND g.source = 'ghl'
      JOIN public.property_data_sources t ON t.property_id = p.id AND t.source = 'ctm'
      LEFT JOIN mops.form_sync_config c ON c.property_id = p.id
      WHERE p.is_active));

  ELSIF _op = 'formsync_recon_forms_upsert' THEN
    -- Discovery never overwrites a manual classification.
    FOR it IN SELECT * FROM jsonb_array_elements(coalesce(_args->'forms','[]'::jsonb)) LOOP
      INSERT INTO mops.recon_forms AS f (property_id, ghl_form_id, name, classification, form_source, ctm_form_name, message_key, message_key_candidates, submissions_30d)
      VALUES (pid, it->>'id', it->>'name', coalesce(it->>'classification','unclassified'), nullif(it->>'form_source',''), it->>'name', nullif(it->>'message_key',''), coalesce(it->'message_key_candidates','[]'), coalesce((it->>'submissions_30d')::int,0))
      ON CONFLICT (property_id, ghl_form_id) DO UPDATE SET
        name = excluded.name, last_seen_at = now(), submissions_30d = excluded.submissions_30d, message_key_candidates = excluded.message_key_candidates,
        classification = CASE WHEN f.classification_source = 'manual' THEN f.classification ELSE excluded.classification END,
        form_source = CASE WHEN f.classification_source = 'manual' THEN f.form_source ELSE excluded.form_source END,
        message_key = CASE WHEN f.classification_source = 'manual' THEN coalesce(f.message_key, excluded.message_key) ELSE excluded.message_key END;
    END LOOP;
    RETURN jsonb_build_object('ok', true);

  ELSIF _op = 'formsync_recon_preflight_save' THEN
    INSERT INTO mops.form_sync_config (property_id, ctm_form_reactor_id, ctm_form_numeric_id, message_field, activation_at)
    VALUES (pid, coalesce(_args->>'frt',''), nullif(_args->>'form_numeric_id',''), coalesce(nullif(_args->>'message_field',''),'how_can_we_help_your_dog'), NULL)
    ON CONFLICT (property_id) DO NOTHING;
    SELECT * INTO cfg FROM mops.form_sync_config WHERE property_id = pid FOR UPDATE;
    mb := cfg.mode; ok := coalesce((_args->>'passed')::boolean,false);
    IF cfg.manual_hold THEN st := 'manual_hold'; ma := cfg.mode;
    ELSIF cfg.mode = 'live' THEN st := CASE WHEN ok THEN 'passed' ELSE 'failed' END; ma := 'live';  -- never changed automatically
    ELSIF ok THEN st := 'passed'; ma := 'monitor';
    ELSE st := 'failed'; ma := 'off';
    END IF;
    IF cfg.mode <> 'live' AND NOT cfg.manual_hold THEN
      UPDATE mops.form_sync_config SET
        ctm_form_reactor_id = CASE WHEN ok THEN coalesce(nullif(_args->>'frt',''), ctm_form_reactor_id) ELSE ctm_form_reactor_id END,
        ctm_form_numeric_id = CASE WHEN ok THEN coalesce(nullif(_args->>'form_numeric_id',''), ctm_form_numeric_id) ELSE ctm_form_numeric_id END,
        message_field = CASE WHEN ok THEN coalesce(nullif(_args->>'message_field',''), message_field) ELSE message_field END,
        mode = ma, schedule_enabled = (ma = 'monitor'), delivery_enabled = false,
        activation_at = CASE WHEN ma = 'monitor' AND mode <> 'monitor' THEN now() ELSE activation_at END,
        readiness = CASE WHEN ok THEN 'needs_live_validation' ELSE NULL END,
        matching_verified = coalesce((_args->>'matching_verified')::boolean,false)
      WHERE property_id = pid;
      PERFORM mops.recon_rebuild_form_map(pid);
    END IF;
    UPDATE mops.form_sync_config SET preflight_status = st, preflight_reasons = coalesce(_args->'reasons','[]'), preflight_at = now(), preflight_requested = false WHERE property_id = pid;
    INSERT INTO mops.recon_preflight_runs (property_id, actor, outcome, mode_before, mode_after, checks) VALUES (pid, _actor, st, mb, ma, coalesce(_args->'checks','[]'));
    RETURN jsonb_build_object('status', st, 'mode', ma);

  ELSIF _op = 'formsync_recon_overview' THEN
    RETURN jsonb_build_object(
      'runtime', (SELECT to_jsonb(r) - 'lease_until' FROM mops.recon_runtime r),
      'locations', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'property_id', c.property_id, 'property_name', p.name, 'mode', c.mode, 'manual_hold', c.manual_hold, 'manual_hold_reason', c.manual_hold_reason,
        'readiness', c.readiness, 'matching_verified', c.matching_verified, 'preflight_status', c.preflight_status, 'preflight_reasons', c.preflight_reasons,
        'preflight_at', c.preflight_at, 'activation_at', c.activation_at, 'call_expectation', c.call_expectation, 'form_reactor', c.ctm_form_numeric_id,
        'last_success_at', k.last_success_at, 'last_run_at', k.last_run_at, 'consecutive_failures', coalesce(k.consecutive_failures,0), 'last_error', k.last_error,
        'forms', (SELECT jsonb_build_object('inquiry', count(*) FILTER (WHERE classification='inquiry'), 'operational', count(*) FILTER (WHERE classification='operational'),
                   'unclassified', count(*) FILTER (WHERE classification='unclassified'), 'monitored', count(*) FILTER (WHERE classification='inquiry' AND form_source IS NOT NULL AND message_key IS NOT NULL))
                  FROM mops.recon_forms f WHERE f.property_id = c.property_id),
        'calls_open', (SELECT count(*) FROM mops.recon_call_discrepancies d WHERE d.property_id = c.property_id AND d.status='open'),
        'rows', (SELECT coalesce(jsonb_agg(jsonb_build_object('d', s.submitted_at::date, 'src', s.form_source, 'st', s.status, 'rec', s.recovered, 'q', s.qualification, 'dup', (s.match_detail->>'stage') = 'pre-delivery')), '[]'::jsonb)
                 FROM mops.form_sync_submissions s WHERE s.property_id = c.property_id AND s.submitted_at >= coalesce(nullif(_args->>'from','')::timestamptz, now() - interval '30 days'))
      ) ORDER BY p.name), '[]'::jsonb)
      FROM mops.form_sync_config c JOIN public.properties p ON p.id = c.property_id LEFT JOIN mops.form_sync_checkpoints k ON k.property_id = c.property_id));

  ELSIF _op = 'formsync_recon_location' THEN
    RETURN jsonb_build_object(
      'forms', (SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.classification, f.name), '[]'::jsonb) FROM mops.recon_forms f WHERE f.property_id = pid),
      'preflight', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.at DESC), '[]'::jsonb) FROM (SELECT * FROM mops.recon_preflight_runs WHERE property_id = pid ORDER BY at DESC LIMIT 10) r),
      'calls', (SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.called_at DESC), '[]'::jsonb) FROM (SELECT * FROM mops.recon_call_discrepancies WHERE property_id = pid ORDER BY called_at DESC LIMIT 100) d),
      'history', (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.at DESC), '[]'::jsonb) FROM (SELECT * FROM mops.form_sync_attempts WHERE property_id = pid ORDER BY at DESC LIMIT 100) a));

  ELSIF _op = 'formsync_recon_form_classify' THEN
    IF _actor IS NULL THEN RETURN jsonb_build_object('error','not_found'); END IF;
    UPDATE mops.recon_forms SET classification = coalesce(nullif(_args->>'classification',''), classification),
      form_source = CASE WHEN _args ? 'form_source' THEN nullif(_args->>'form_source','') ELSE form_source END,
      message_key = CASE WHEN _args ? 'message_key' THEN nullif(_args->>'message_key','') ELSE message_key END,
      classification_source = 'manual', reviewed_by = _actor, reviewed_at = now()
    WHERE property_id = pid AND ghl_form_id = _args->>'ghl_form_id';
    PERFORM mops.recon_rebuild_form_map(pid);
    INSERT INTO mops.form_sync_attempts (property_id, actor, kind, outcome, detail) VALUES (pid, _actor, 'form_review', coalesce(_args->>'classification','updated'), _args);
    RETURN jsonb_build_object('ok', true);

  ELSIF _op = 'formsync_recon_set_hold' THEN
    IF _actor IS NULL THEN RETURN jsonb_build_object('error','not_found'); END IF;
    IF coalesce((_args->>'hold')::boolean,false) THEN
      UPDATE mops.form_sync_config SET manual_hold = true, manual_hold_reason = coalesce(nullif(_args->>'reason',''),'Paused by administrator'),
        mode = CASE WHEN mode = 'live' THEN 'live' ELSE 'off' END, schedule_enabled = false, delivery_enabled = false WHERE property_id = pid;
    ELSE
      UPDATE mops.form_sync_config SET manual_hold = false, manual_hold_reason = NULL, mode = CASE WHEN mode='live' THEN 'monitor' ELSE mode END, preflight_requested = true WHERE property_id = pid;
    END IF;
    INSERT INTO mops.form_sync_attempts (property_id, actor, kind, outcome, detail) VALUES (pid, _actor, 'control', CASE WHEN (_args->>'hold')::boolean THEN 'paused' ELSE 'resumed' END, _args);
    RETURN jsonb_build_object('ok', true);

  ELSIF _op = 'formsync_recon_set_live' THEN
    -- Explicit administrator approval only. Requires passed checks and no hold.
    IF _actor IS NULL THEN RETURN jsonb_build_object('error','not_found'); END IF;
    IF coalesce((_args->>'live')::boolean,false) THEN
      UPDATE mops.form_sync_config SET mode = 'live', delivery_enabled = true, schedule_enabled = true, readiness = 'approved_live'
      WHERE property_id = pid AND NOT manual_hold AND preflight_status = 'passed' AND mode = 'monitor' AND form_map <> '{}'::jsonb RETURNING property_id INTO pid;
      IF pid IS NULL THEN RETURN jsonb_build_object('error','Location must pass its checks, be monitoring, and have at least one ready form before live sending'); END IF;
    ELSE
      UPDATE mops.form_sync_config SET mode = 'monitor', delivery_enabled = false WHERE property_id = pid AND mode = 'live';
    END IF;
    INSERT INTO mops.form_sync_attempts (property_id, actor, kind, outcome) VALUES (pid, _actor, 'control', CASE WHEN (_args->>'live')::boolean THEN 'live_approved' ELSE 'live_stopped' END);
    RETURN jsonb_build_object('ok', true);

  ELSIF _op = 'formsync_recon_set_call_expectation' THEN
    IF _actor IS NULL THEN RETURN jsonb_build_object('error','not_found'); END IF;
    UPDATE mops.form_sync_config SET call_expectation = _args->>'expectation', call_expectation_note = nullif(_args->>'note','') WHERE property_id = pid;
    UPDATE mops.recon_call_discrepancies SET expectation = _args->>'expectation' WHERE property_id = pid AND status = 'open';
    INSERT INTO mops.form_sync_attempts (property_id, actor, kind, outcome, detail) VALUES (pid, _actor, 'control', 'call_expectation', _args);
    RETURN jsonb_build_object('ok', true);

  ELSIF _op = 'formsync_recon_request_preflight' THEN
    UPDATE mops.form_sync_config SET preflight_requested = true WHERE property_id = pid;
    RETURN jsonb_build_object('ok', true);

  ELSIF _op = 'formsync_recon_calls_check' THEN
    -- Monitor only. Reads synced CTM calls and GHL contacts; never writes to either system.
    WITH cand AS (
      SELECT c.property_id, c.ctm_call_id, c.called_at, '***' || right(regexp_replace(c.caller_number,'\D','','g'),4) AS masked, cf.call_expectation
      FROM public.ctm_calls c JOIN mops.form_sync_config cf ON cf.property_id = c.property_id AND cf.mode <> 'off'
      WHERE c.called_at BETWEEN now() - interval '3 days' AND now() - interval '2 hours'
        AND coalesce(c.raw_payload->>'direction','inbound') = 'inbound'
        AND (c.raw_payload->'form' IS NULL OR c.raw_payload->'form' = 'null'::jsonb)
        AND length(regexp_replace(coalesce(c.caller_number,''),'\D','','g')) >= 10
        AND NOT EXISTS (SELECT 1 FROM public.ghl_contacts g WHERE g.property_id = c.property_id AND g.phone IS NOT NULL
              AND right(regexp_replace(g.phone,'\D','','g'),10) = right(regexp_replace(c.caller_number,'\D','','g'),10))
    )
    INSERT INTO mops.recon_call_discrepancies (property_id, ctm_call_id, called_at, caller_masked, expectation)
    SELECT property_id, ctm_call_id, called_at, masked, call_expectation FROM cand
    ON CONFLICT (property_id, ctm_call_id, kind) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
    UPDATE mops.recon_call_discrepancies d SET status = 'resolved', resolved_at = now()
    FROM public.ctm_calls c
    WHERE d.status = 'open' AND c.property_id = d.property_id AND c.ctm_call_id = d.ctm_call_id
      AND EXISTS (SELECT 1 FROM public.ghl_contacts g WHERE g.property_id = c.property_id AND g.phone IS NOT NULL
              AND right(regexp_replace(g.phone,'\D','','g'),10) = right(regexp_replace(c.caller_number,'\D','','g'),10));
    UPDATE mops.recon_runtime SET last_calls_check_at = now() WHERE id = 1;
    RETURN jsonb_build_object('new', n);

  ELSIF _op = 'formsync_recon_runtime' THEN
    IF _args->>'action' = 'lease' THEN
      UPDATE mops.recon_runtime SET lease_until = now() + interval '4 minutes' WHERE id = 1 AND (lease_until IS NULL OR lease_until < now()) RETURNING to_jsonb(recon_runtime.*) INTO res;
      RETURN jsonb_build_object('acquired', res IS NOT NULL, 'runtime', res);
    ELSIF _args->>'action' = 'finish' THEN
      UPDATE mops.recon_runtime SET lease_until = NULL, last_scheduled_run_at = now() WHERE id = 1;
      RETURN jsonb_build_object('ok', true);
    END IF;
    RETURN jsonb_build_object('runtime', (SELECT to_jsonb(r) FROM mops.recon_runtime r));

  ELSIF _op = 'formsync_recon_alert_items' THEN
    SELECT * INTO cfg FROM mops.form_sync_config WHERE property_id = pid;
    RETURN jsonb_build_object(
      'property_name', (SELECT name FROM public.properties WHERE id = pid),
      'recipient', (SELECT u.email FROM mops.access_grants g JOIN auth.users u ON u.id = g.user_id WHERE g.revoked_at IS NULL LIMIT 1),
      'mode', cfg.mode, 'manual_hold', cfg.manual_hold, 'preflight_status', cfg.preflight_status, 'preflight_reasons', cfg.preflight_reasons,
      'consecutive_failures', (SELECT consecutive_failures FROM mops.form_sync_checkpoints WHERE property_id = pid),
      'last_error', (SELECT last_error FROM mops.form_sync_checkpoints WHERE property_id = pid),
      'review', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'submitted_at', submitted_at, 'form_source', form_source, 'masked', masked)), '[]'::jsonb)
        FROM mops.form_sync_submissions WHERE property_id = pid AND status = 'needs_review' AND alerted_review_at IS NULL),
      'calls_expected', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'called_at', called_at, 'caller', caller_masked)), '[]'::jsonb)
        FROM mops.recon_call_discrepancies WHERE property_id = pid AND status = 'open' AND alerted_at IS NULL AND expectation = 'expected'),
      'calls_unverified', (SELECT count(*) FROM mops.recon_call_discrepancies WHERE property_id = pid AND status = 'open' AND expectation = 'unverified'),
      'state', (SELECT coalesce(jsonb_object_agg(key, jsonb_build_object('state', state, 'alerted_at', alerted_at)), '{}'::jsonb) FROM mops.recon_alert_state WHERE key LIKE pid::text || ':%'));

  ELSIF _op = 'formsync_recon_mark_alert' THEN
    IF _args ? 'key' THEN
      INSERT INTO mops.recon_alert_state (key, state, alerted_at) VALUES (_args->>'key', _args->>'state', CASE WHEN coalesce((_args->>'sent')::boolean,true) THEN now() END)
      ON CONFLICT (key) DO UPDATE SET state = excluded.state, alerted_at = coalesce(excluded.alerted_at, mops.recon_alert_state.alerted_at);
    END IF;
    IF _args ? 'review_ids' THEN UPDATE mops.form_sync_submissions SET alerted_review_at = now() WHERE id IN (SELECT (jsonb_array_elements_text(_args->'review_ids'))::uuid); END IF;
    IF _args ? 'call_ids' THEN UPDATE mops.recon_call_discrepancies SET alerted_at = now() WHERE id IN (SELECT (jsonb_array_elements_text(_args->'call_ids'))::uuid); END IF;
    RETURN jsonb_build_object('ok', true);
  END IF;
  RETURN jsonb_build_object('error','unknown op');
END $$;
REVOKE ALL ON FUNCTION mops.recon_core(uuid,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mops_formsync_api(_actor uuid, _endpoint text, _op text, _args jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT mops.check_grant(_actor) OR _op NOT LIKE 'formsync\_%' THEN
    INSERT INTO mops.audit_log (actor, endpoint, op, outcome) VALUES (_actor, _endpoint, _op, 'denied');
    RETURN jsonb_build_object('error','not_found');
  END IF;
  INSERT INTO mops.audit_log (actor, endpoint, op, target, outcome) VALUES (_actor, _endpoint, _op, coalesce(_args->>'property_id', _args->>'id'), 'allowed');
  IF _op = 'formsync_claimed' THEN RETURN mops.formsync_claimed((_args->>'property_id')::uuid); END IF;
  IF _op LIKE 'formsync\_recon\_%' THEN RETURN mops.recon_core(_actor, _op, _args); END IF;
  RETURN mops.formsync_core(_actor, _op, _args);
END $$;

-- Scheduled path: narrow list; cannot classify forms, approve live, change holds or call expectations.
CREATE OR REPLACE FUNCTION public.mops_formsync_internal(_op text, _args jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF _op NOT IN ('formsync_config','formsync_scheduled_locations','formsync_ingest','formsync_run_failed','formsync_set','formsync_work',
                 'formsync_claim','formsync_claimed','formsync_qualify','formsync_alerts','formsync_mark_alerted',
                 'formsync_recon_candidates','formsync_recon_forms_upsert','formsync_recon_preflight_save','formsync_recon_calls_check',
                 'formsync_recon_runtime','formsync_recon_alert_items','formsync_recon_mark_alert') THEN
    RETURN jsonb_build_object('error','not_found');
  END IF;
  IF _op = 'formsync_set' AND coalesce((_args->>'review')::boolean,false) THEN RETURN jsonb_build_object('error','not_found'); END IF;
  IF _op NOT IN ('formsync_work','formsync_config','formsync_scheduled_locations','formsync_alerts','formsync_claimed','formsync_recon_candidates','formsync_recon_runtime','formsync_recon_alert_items') THEN
    INSERT INTO mops.audit_log (actor, endpoint, op, target, outcome) VALUES (NULL, 'mops-form-sync:scheduled', _op, coalesce(_args->>'property_id', _args->>'id'), 'allowed');
  END IF;
  IF _op = 'formsync_claimed' THEN RETURN mops.formsync_claimed((_args->>'property_id')::uuid); END IF;
  IF _op LIKE 'formsync\_recon\_%' THEN RETURN mops.recon_core(NULL, _op, _args); END IF;
  IF _op = 'formsync_scheduled_locations' THEN
    RETURN jsonb_build_object('locations', (SELECT coalesce(jsonb_agg(property_id), '[]'::jsonb) FROM mops.form_sync_config WHERE schedule_enabled AND mode IN ('monitor','live') AND NOT manual_hold));
  END IF;
  RETURN mops.formsync_core(NULL, _op, _args);
END $$;
