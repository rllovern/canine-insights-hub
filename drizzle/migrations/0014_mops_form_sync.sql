CREATE TABLE mops.form_sync_config (
  property_id uuid PRIMARY KEY REFERENCES public.properties(id) ON DELETE CASCADE,
  ctm_form_reactor_id text NOT NULL,
  ctm_form_numeric_id text,
  message_field text NOT NULL DEFAULT 'how_can_we_help_your_dog',
  ghl_message_key text,
  delivery_enabled boolean NOT NULL DEFAULT false,
  schedule_enabled boolean NOT NULL DEFAULT false,
  lookback_minutes int NOT NULL DEFAULT 120,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE mops.form_sync_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  ghl_submission_id text NOT NULL,
  ghl_contact_id text,
  ghl_form_id text,
  submitted_at timestamptz NOT NULL,
  masked jsonb NOT NULL DEFAULT '{}'::jsonb,
  message_hash text,
  attribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','matched','pending_delivery','pending_verification','delivered','failed','needs_review')),
  ctm_activity_id text,
  match_detail jsonb,
  dry_run_payload jsonb,
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  last_error text,
  recovered boolean NOT NULL DEFAULT false,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT form_sync_unique_submission UNIQUE (property_id, ghl_submission_id)
);
CREATE INDEX ON mops.form_sync_submissions (property_id, submitted_at DESC);
CREATE TABLE mops.form_sync_attempts (
  id bigserial PRIMARY KEY,
  submission_id uuid REFERENCES mops.form_sync_submissions(id) ON DELETE RESTRICT,
  property_id uuid,
  at timestamptz NOT NULL DEFAULT now(),
  actor uuid,
  kind text NOT NULL,
  outcome text NOT NULL,
  detail jsonb
);
CREATE TRIGGER form_sync_attempts_protect BEFORE UPDATE OR DELETE ON mops.form_sync_attempts FOR EACH ROW EXECUTE FUNCTION mops.block_change();
CREATE TRIGGER form_sync_attempts_no_truncate BEFORE TRUNCATE ON mops.form_sync_attempts FOR EACH STATEMENT EXECUTE FUNCTION mops.block_change();
CREATE TABLE mops.form_sync_checkpoints (
  property_id uuid PRIMARY KEY REFERENCES public.properties(id) ON DELETE CASCADE,
  last_window_end timestamptz,
  last_success_at timestamptz,
  last_run_at timestamptz,
  consecutive_failures int NOT NULL DEFAULT 0,
  last_error text
);
ALTER TABLE mops.form_sync_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE mops.form_sync_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mops.form_sync_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE mops.form_sync_checkpoints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mops.form_sync_config, mops.form_sync_submissions, mops.form_sync_attempts, mops.form_sync_checkpoints FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE mops.form_sync_attempts_id_seq FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO mops.form_sync_config (property_id, ctm_form_reactor_id, ctm_form_numeric_id, ghl_message_key)
VALUES ('cbd7adea-bed7-4b2a-ab71-69194fe9fc62', 'FRT472ABB2C5B9B141AB5442EF7B46049EB4459B8006A953EE62E765E5535977F92', '238140', '7JAaPjDMaiAPytxEaTzN');

-- Core: no grants to anyone but owner. Callers below wrap it.
CREATE OR REPLACE FUNCTION mops.formsync_core(_actor uuid, _op text, _args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  pid uuid := nullif(_args->>'property_id','')::uuid;
  it jsonb; sid uuid; n_new int := 0; res jsonb;
BEGIN
  IF _op = 'formsync_overview' THEN
    RETURN jsonb_build_object('locations', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'property_id', c.property_id, 'property_name', p.name,
      'delivery_enabled', c.delivery_enabled, 'schedule_enabled', c.schedule_enabled,
      'form_reactor', c.ctm_form_numeric_id,
      'last_success_at', k.last_success_at, 'last_run_at', k.last_run_at, 'consecutive_failures', coalesce(k.consecutive_failures,0), 'last_error', k.last_error,
      'counts', (SELECT jsonb_build_object(
          'received', count(*),
          'confirmed', count(*) FILTER (WHERE s.status IN ('matched','delivered')),
          'recovered', count(*) FILTER (WHERE s.recovered),
          'awaiting', count(*) FILTER (WHERE s.status IN ('received','pending_delivery','pending_verification','needs_review')),
          'needs_review', count(*) FILTER (WHERE s.status = 'needs_review'),
          'failed', count(*) FILTER (WHERE s.status = 'failed'),
          'stale', count(*) FILTER (WHERE s.status NOT IN ('matched','delivered') AND s.first_seen_at < now() - interval '15 minutes'))
        FROM mops.form_sync_submissions s WHERE s.property_id = c.property_id)
    ) ORDER BY p.name), '[]'::jsonb) FROM mops.form_sync_config c JOIN public.properties p ON p.id = c.property_id LEFT JOIN mops.form_sync_checkpoints k ON k.property_id = c.property_id));

  ELSIF _op = 'formsync_config' THEN
    SELECT to_jsonb(c) INTO res FROM mops.form_sync_config c WHERE property_id = pid;
    RETURN jsonb_build_object('config', res, 'checkpoint', (SELECT to_jsonb(k) FROM mops.form_sync_checkpoints k WHERE property_id = pid));

  ELSIF _op = 'formsync_list' THEN
    RETURN jsonb_build_object('submissions', (SELECT coalesce(jsonb_agg(to_jsonb(s) - 'message_hash' ORDER BY s.submitted_at DESC), '[]'::jsonb)
      FROM (SELECT * FROM mops.form_sync_submissions WHERE property_id = pid ORDER BY submitted_at DESC LIMIT 200) s));

  ELSIF _op = 'formsync_attempts' THEN
    RETURN jsonb_build_object('attempts', (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.at DESC), '[]'::jsonb)
      FROM mops.form_sync_attempts a WHERE a.submission_id = (_args->>'id')::uuid));

  ELSIF _op = 'formsync_get' THEN
    RETURN jsonb_build_object('submission', (SELECT to_jsonb(s) FROM mops.form_sync_submissions s WHERE s.id = (_args->>'id')::uuid));

  ELSIF _op = 'formsync_ingest' THEN
    -- Records each submission once; existing rows keep their status and history.
    FOR it IN SELECT * FROM jsonb_array_elements(coalesce(_args->'items','[]'::jsonb)) LOOP
      INSERT INTO mops.form_sync_submissions (property_id, ghl_submission_id, ghl_contact_id, ghl_form_id, submitted_at, masked, message_hash, attribution)
      VALUES (pid, it->>'ghl_submission_id', it->>'ghl_contact_id', it->>'ghl_form_id', (it->>'submitted_at')::timestamptz,
              coalesce(it->'masked','{}'), it->>'message_hash', coalesce(it->'attribution','{}'))
      ON CONFLICT (property_id, ghl_submission_id) DO NOTHING
      RETURNING id INTO sid;
      IF sid IS NOT NULL THEN
        n_new := n_new + 1;
        INSERT INTO mops.form_sync_attempts (submission_id, property_id, actor, kind, outcome) VALUES (sid, pid, _actor, 'ingest', 'received');
      END IF;
      sid := NULL;
    END LOOP;
    INSERT INTO mops.form_sync_checkpoints (property_id, last_window_end, last_success_at, last_run_at, consecutive_failures, last_error)
    VALUES (pid, (_args->>'window_end')::timestamptz, now(), now(), 0, NULL)
    ON CONFLICT (property_id) DO UPDATE SET last_window_end = greatest(mops.form_sync_checkpoints.last_window_end, excluded.last_window_end),
      last_success_at = now(), last_run_at = now(), consecutive_failures = 0, last_error = NULL;
    RETURN jsonb_build_object('new', n_new);

  ELSIF _op = 'formsync_run_failed' THEN
    INSERT INTO mops.form_sync_checkpoints (property_id, last_run_at, consecutive_failures, last_error)
    VALUES (pid, now(), 1, left(_args->>'error', 500))
    ON CONFLICT (property_id) DO UPDATE SET last_run_at = now(), consecutive_failures = mops.form_sync_checkpoints.consecutive_failures + 1, last_error = left(excluded.last_error, 500);
    INSERT INTO mops.form_sync_attempts (property_id, actor, kind, outcome, detail) VALUES (pid, _actor, 'run', 'failed', jsonb_build_object('error', left(_args->>'error', 500)));
    RETURN jsonb_build_object('ok', true);

  ELSIF _op = 'formsync_set' THEN
    -- Status transition from reconcile/review/dry-run. Delivered/matched rows never move backward except by explicit review.
    sid := (_args->>'id')::uuid;
    UPDATE mops.form_sync_submissions s SET
      status = coalesce(_args->>'status', s.status),
      ctm_activity_id = CASE WHEN _args ? 'ctm_activity_id' THEN nullif(_args->>'ctm_activity_id','') ELSE s.ctm_activity_id END,
      match_detail = CASE WHEN _args ? 'match_detail' THEN _args->'match_detail' ELSE s.match_detail END,
      dry_run_payload = CASE WHEN _args ? 'dry_run_payload' THEN _args->'dry_run_payload' ELSE s.dry_run_payload END,
      last_error = CASE WHEN _args ? 'last_error' THEN nullif(_args->>'last_error','') ELSE s.last_error END,
      recovered = coalesce((_args->>'recovered')::boolean, s.recovered),
      attempts = s.attempts + CASE WHEN coalesce((_args->>'count_attempt')::boolean,false) THEN 1 ELSE 0 END,
      next_attempt_at = CASE WHEN _args ? 'next_attempt_at' THEN nullif(_args->>'next_attempt_at','')::timestamptz ELSE s.next_attempt_at END,
      updated_at = now()
    WHERE s.id = sid AND (s.status NOT IN ('matched','delivered') OR coalesce((_args->>'review')::boolean,false))
    RETURNING property_id INTO pid;
    IF pid IS NULL THEN RETURN jsonb_build_object('ok', false, 'skipped', 'final_or_missing'); END IF;
    INSERT INTO mops.form_sync_attempts (submission_id, property_id, actor, kind, outcome, detail)
    VALUES (sid, pid, _actor, coalesce(_args->>'kind','update'), coalesce(_args->>'status','update'), _args->'log');
    RETURN jsonb_build_object('ok', true);
  END IF;
  RETURN jsonb_build_object('error','unknown op');
END $$;
REVOKE ALL ON FUNCTION mops.formsync_core(uuid,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Granted-user entry point (same grant check as mops_api).
CREATE OR REPLACE FUNCTION public.mops_formsync_api(_actor uuid, _endpoint text, _op text, _args jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT mops.check_grant(_actor) OR _op NOT LIKE 'formsync\_%' THEN
    INSERT INTO mops.audit_log (actor, endpoint, op, outcome) VALUES (_actor, _endpoint, _op, 'denied');
    RETURN jsonb_build_object('error','not_found');
  END IF;
  INSERT INTO mops.audit_log (actor, endpoint, op, target, outcome) VALUES (_actor, _endpoint, _op, coalesce(_args->>'property_id', _args->>'id'), 'allowed');
  RETURN mops.formsync_core(_actor, _op, _args);
END $$;
REVOKE ALL ON FUNCTION public.mops_formsync_api(uuid,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mops_formsync_api(uuid,text,text,jsonb) TO service_role;

-- Approved internal exception for the (future) scheduled run: ingest/reconcile ops only, no reads of lists.
CREATE OR REPLACE FUNCTION public.mops_formsync_internal(_op text, _args jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF _op NOT IN ('formsync_config','formsync_ingest','formsync_run_failed','formsync_set','formsync_list_open') THEN
    RETURN jsonb_build_object('error','not_found');
  END IF;
  IF _op = 'formsync_set' AND coalesce((_args->>'review')::boolean,false) THEN RETURN jsonb_build_object('error','not_found'); END IF;
  INSERT INTO mops.audit_log (actor, endpoint, op, target, outcome) VALUES (NULL, 'mops-form-sync:scheduled', _op, _args->>'property_id', 'allowed');
  IF _op = 'formsync_list_open' THEN
    RETURN jsonb_build_object('submissions', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'ghl_submission_id', ghl_submission_id, 'status', status, 'attempts', attempts, 'next_attempt_at', next_attempt_at)), '[]'::jsonb)
      FROM mops.form_sync_submissions WHERE property_id = (_args->>'property_id')::uuid AND status NOT IN ('matched','delivered')));
  END IF;
  RETURN mops.formsync_core(NULL, _op, _args);
END $$;
REVOKE ALL ON FUNCTION public.mops_formsync_internal(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mops_formsync_internal(text,jsonb) TO service_role;