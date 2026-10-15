ALTER TABLE mops.form_sync_config
  ADD COLUMN activation_at timestamptz,
  ADD COLUMN grace_minutes int NOT NULL DEFAULT 15,
  ADD COLUMN qualify_minutes int NOT NULL DEFAULT 5,
  ADD COLUMN alert_minutes int NOT NULL DEFAULT 30,
  ADD COLUMN max_attempts int NOT NULL DEFAULT 6,
  ADD COLUMN form_map jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE mops.form_sync_submissions
  ADD COLUMN hold_reason text,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN approved_by uuid,
  ADD COLUMN lock_token uuid,
  ADD COLUMN lock_until timestamptz,
  ADD COLUMN delivery_ref text,
  ADD COLUMN posted_at timestamptz,
  ADD COLUMN ctm_created_at timestamptz,
  ADD COLUMN form_source text,
  ADD COLUMN qualification text CHECK (qualification IN ('pending','classified','needs_qualification')),
  ADD COLUMN ctm_tag text,
  ADD COLUMN qualification_checked_at timestamptz,
  ADD COLUMN alerted_unconfirmed_at timestamptz,
  ADD COLUMN alerted_qualification_at timestamptz;

ALTER TABLE mops.form_sync_submissions DROP CONSTRAINT form_sync_submissions_status_check;
ALTER TABLE mops.form_sync_submissions ADD CONSTRAINT form_sync_submissions_status_check
  CHECK (status IN ('received','held','matched','pending_delivery','pending_verification','delivered','failed','needs_review'));

-- DFW: fixed activation timestamp and the two mapped GHL forms (others are held for a decision).
UPDATE mops.form_sync_config SET activation_at = '2026-10-15T17:00:00Z',
  form_map = '{"qm5V09KmznBu9qr8Rg9R":{"form_name":"New Client Form","form_source":"ppc","label":"Google Ads (PPC)"},"BhIOk9O1aBY67meflSjI":{"form_name":"New Client Form","form_source":"website","label":"Website Organic"}}'::jsonb
  WHERE property_id = 'cbd7adea-bed7-4b2a-ab71-69194fe9fc62';

-- Backfill: everything before activation that is not already confirmed stays on hold.
INSERT INTO mops.form_sync_attempts (submission_id, property_id, kind, outcome, detail)
  SELECT id, property_id, 'hold', 'held', jsonb_build_object('reason','before_activation','previous_status',status)
  FROM mops.form_sync_submissions WHERE submitted_at < '2026-10-15T17:00:00Z' AND status NOT IN ('matched','delivered');
UPDATE mops.form_sync_submissions SET hold_reason = 'before_activation', status = 'held', updated_at = now()
  WHERE submitted_at < '2026-10-15T17:00:00Z' AND status NOT IN ('matched','delivered');
UPDATE mops.form_sync_submissions s SET form_source = c.form_map->s.ghl_form_id->>'form_source'
  FROM mops.form_sync_config c WHERE c.property_id = s.property_id;
UPDATE mops.form_sync_submissions SET qualification = 'pending', approved_at = now()
  WHERE ghl_submission_id = '6acfcd7415e56fb9d9826d9d' AND status = 'delivered';

CREATE OR REPLACE FUNCTION mops.formsync_core(_actor uuid, _op text, _args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  pid uuid := nullif(_args->>'property_id','')::uuid;
  it jsonb; sid uuid; n_new int := 0; res jsonb; cfg mops.form_sync_config; st text; hr text; tok uuid;
BEGIN
  IF _op = 'formsync_overview' THEN
    RETURN jsonb_build_object('locations', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'property_id', c.property_id, 'property_name', p.name,
      'delivery_enabled', c.delivery_enabled, 'schedule_enabled', c.schedule_enabled, 'activation_at', c.activation_at,
      'grace_minutes', c.grace_minutes, 'form_reactor', c.ctm_form_numeric_id, 'form_map', c.form_map,
      'last_success_at', k.last_success_at, 'last_run_at', k.last_run_at, 'consecutive_failures', coalesce(k.consecutive_failures,0), 'last_error', k.last_error,
      'counts', (SELECT jsonb_build_object(
          'received', count(*),
          'confirmed', count(*) FILTER (WHERE s.status IN ('matched','delivered')),
          'delivered', count(*) FILTER (WHERE s.status = 'delivered'),
          'matched', count(*) FILTER (WHERE s.status = 'matched'),
          'recovered', count(*) FILTER (WHERE s.recovered),
          'pending', count(*) FILTER (WHERE s.status IN ('received','pending_delivery','pending_verification')),
          'awaiting', count(*) FILTER (WHERE s.status IN ('received','pending_delivery','pending_verification','needs_review')),
          'needs_review', count(*) FILTER (WHERE s.status = 'needs_review'),
          'held', count(*) FILTER (WHERE s.status = 'held'),
          'failed', count(*) FILTER (WHERE s.status = 'failed'),
          'needs_qualification', count(*) FILTER (WHERE s.qualification = 'needs_qualification'),
          'stale', count(*) FILTER (WHERE s.status NOT IN ('matched','delivered','held') AND s.submitted_at < now() - make_interval(mins => c.alert_minutes)))
        FROM mops.form_sync_submissions s WHERE s.property_id = c.property_id)
    ) ORDER BY p.name), '[]'::jsonb) FROM mops.form_sync_config c JOIN public.properties p ON p.id = c.property_id LEFT JOIN mops.form_sync_checkpoints k ON k.property_id = c.property_id));

  ELSIF _op = 'formsync_config' THEN
    SELECT to_jsonb(c) INTO res FROM mops.form_sync_config c WHERE property_id = pid;
    RETURN jsonb_build_object('config', res, 'checkpoint', (SELECT to_jsonb(k) FROM mops.form_sync_checkpoints k WHERE property_id = pid));

  ELSIF _op = 'formsync_scheduled_locations' THEN
    RETURN jsonb_build_object('locations', (SELECT coalesce(jsonb_agg(property_id), '[]'::jsonb) FROM mops.form_sync_config WHERE schedule_enabled));

  ELSIF _op = 'formsync_list' THEN
    RETURN jsonb_build_object('submissions', (SELECT coalesce(jsonb_agg(to_jsonb(s) - 'message_hash' - 'lock_token' ORDER BY s.submitted_at DESC), '[]'::jsonb)
      FROM (SELECT * FROM mops.form_sync_submissions WHERE property_id = pid ORDER BY submitted_at DESC LIMIT 200) s));

  ELSIF _op = 'formsync_work' THEN
    -- Rows the engine still has to look at (includes message hash for matching; never message text).
    RETURN jsonb_build_object('submissions', (SELECT coalesce(jsonb_agg(to_jsonb(s) - 'lock_token'), '[]'::jsonb) FROM mops.form_sync_submissions s
      WHERE s.property_id = pid AND (s.status IN ('received','pending_delivery','pending_verification','failed')
        OR (s.status IN ('matched','delivered') AND s.ctm_activity_id IS NOT NULL AND coalesce(s.qualification,'pending') <> 'classified'
            AND s.first_seen_at > now() - interval '7 days'))));

  ELSIF _op = 'formsync_attempts' THEN
    RETURN jsonb_build_object('attempts', (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.at DESC), '[]'::jsonb)
      FROM mops.form_sync_attempts a WHERE a.submission_id = (_args->>'id')::uuid));

  ELSIF _op = 'formsync_get' THEN
    RETURN jsonb_build_object('submission', (SELECT to_jsonb(s) - 'lock_token' FROM mops.form_sync_submissions s WHERE s.id = (_args->>'id')::uuid));

  ELSIF _op = 'formsync_ingest' THEN
    SELECT * INTO cfg FROM mops.form_sync_config WHERE property_id = pid;
    FOR it IN SELECT * FROM jsonb_array_elements(coalesce(_args->'items','[]'::jsonb)) LOOP
      IF NOT (cfg.form_map ? coalesce(it->>'ghl_form_id','')) THEN st := 'held'; hr := 'form_not_mapped';
      ELSIF cfg.activation_at IS NULL OR (it->>'submitted_at')::timestamptz < cfg.activation_at THEN st := 'held'; hr := 'before_activation';
      ELSE st := 'received'; hr := NULL; END IF;
      INSERT INTO mops.form_sync_submissions (property_id, ghl_submission_id, ghl_contact_id, ghl_form_id, submitted_at, masked, message_hash, attribution, status, hold_reason, form_source)
      VALUES (pid, it->>'ghl_submission_id', it->>'ghl_contact_id', it->>'ghl_form_id', (it->>'submitted_at')::timestamptz,
              coalesce(it->'masked','{}'), it->>'message_hash', coalesce(it->'attribution','{}'), st, hr, cfg.form_map->(it->>'ghl_form_id')->>'form_source')
      ON CONFLICT (property_id, ghl_submission_id) DO NOTHING
      RETURNING id INTO sid;
      IF sid IS NOT NULL THEN
        n_new := n_new + 1;
        INSERT INTO mops.form_sync_attempts (submission_id, property_id, actor, kind, outcome, detail) VALUES (sid, pid, _actor, 'ingest', st, CASE WHEN hr IS NULL THEN NULL ELSE jsonb_build_object('reason', hr) END);
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

  ELSIF _op = 'formsync_claim' THEN
    -- Atomic per-submission lock; only one worker can hold it.
    UPDATE mops.form_sync_submissions SET lock_token = gen_random_uuid(), lock_until = now() + make_interval(secs => coalesce((_args->>'seconds')::int, 120))
    WHERE id = (_args->>'id')::uuid AND status IN ('pending_delivery','failed') AND (lock_until IS NULL OR lock_until < now())
    RETURNING lock_token INTO tok;
    RETURN jsonb_build_object('lock', tok);

  ELSIF _op = 'formsync_set' THEN
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
      delivery_ref = CASE WHEN _args ? 'delivery_ref' THEN nullif(_args->>'delivery_ref','') ELSE s.delivery_ref END,
      posted_at = CASE WHEN _args ? 'posted_at' THEN nullif(_args->>'posted_at','')::timestamptz ELSE s.posted_at END,
      ctm_created_at = CASE WHEN _args ? 'ctm_created_at' THEN nullif(_args->>'ctm_created_at','')::timestamptz ELSE s.ctm_created_at END,
      qualification = CASE WHEN _args ? 'qualification' THEN nullif(_args->>'qualification','') ELSE s.qualification END,
      hold_reason = CASE WHEN _args ? 'hold_reason' THEN nullif(_args->>'hold_reason','') ELSE s.hold_reason END,
      lock_token = CASE WHEN _args ? 'lock' THEN NULL ELSE s.lock_token END,
      lock_until = CASE WHEN _args ? 'lock' THEN NULL ELSE s.lock_until END,
      updated_at = now()
    WHERE s.id = sid
      AND (s.status NOT IN ('matched','delivered','held') OR coalesce((_args->>'review')::boolean,false))
      AND (NOT (_args ? 'lock') OR s.lock_token = nullif(_args->>'lock','')::uuid)
    RETURNING property_id INTO pid;
    IF pid IS NULL THEN RETURN jsonb_build_object('ok', false, 'skipped', 'final_locked_or_missing'); END IF;
    INSERT INTO mops.form_sync_attempts (submission_id, property_id, actor, kind, outcome, detail)
    VALUES (sid, pid, _actor, coalesce(_args->>'kind','update'), coalesce(_args->>'status','update'), _args->'log');
    RETURN jsonb_build_object('ok', true);

  ELSIF _op = 'formsync_qualify' THEN
    -- Dashboard-only qualification status for confirmed rows. Never writes to CTM.
    UPDATE mops.form_sync_submissions s SET qualification = _args->>'qualification', ctm_tag = nullif(_args->>'ctm_tag',''),
      ctm_created_at = coalesce(s.ctm_created_at, nullif(_args->>'ctm_created_at','')::timestamptz),
      qualification_checked_at = now(), updated_at = now()
    WHERE s.id = (_args->>'id')::uuid AND s.status IN ('matched','delivered') AND _args->>'qualification' IN ('pending','classified','needs_qualification')
    RETURNING property_id INTO pid;
    IF pid IS NOT NULL AND coalesce(_args->>'changed','false') = 'true' THEN
      INSERT INTO mops.form_sync_attempts (submission_id, property_id, actor, kind, outcome, detail)
      VALUES ((_args->>'id')::uuid, pid, _actor, 'qualification', _args->>'qualification', jsonb_build_object('tag', _args->>'ctm_tag'));
    END IF;
    RETURN jsonb_build_object('ok', pid IS NOT NULL);

  ELSIF _op = 'formsync_approve' THEN
    -- Explicit individual approval of a held/review submission for delivery.
    UPDATE mops.form_sync_submissions SET status = 'pending_delivery', approved_at = now(), approved_by = _actor, hold_reason = NULL, next_attempt_at = NULL, updated_at = now()
    WHERE id = (_args->>'id')::uuid AND status IN ('held','needs_review') RETURNING property_id INTO pid;
    IF pid IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
    INSERT INTO mops.form_sync_attempts (submission_id, property_id, actor, kind, outcome) VALUES ((_args->>'id')::uuid, pid, _actor, 'review', 'approved_for_delivery');
    RETURN jsonb_build_object('ok', true);

  ELSIF _op = 'formsync_alerts' THEN
    SELECT * INTO cfg FROM mops.form_sync_config WHERE property_id = pid;
    RETURN jsonb_build_object(
      'unconfirmed', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'submitted_at', submitted_at, 'status', status, 'form_source', form_source, 'masked', masked, 'last_error', last_error)), '[]'::jsonb)
        FROM mops.form_sync_submissions WHERE property_id = pid AND status NOT IN ('matched','delivered','held') AND alerted_unconfirmed_at IS NULL
          AND submitted_at < now() - make_interval(mins => cfg.alert_minutes) AND (submitted_at >= cfg.activation_at OR approved_at IS NOT NULL)),
      'unqualified', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'submitted_at', submitted_at, 'ctm_activity_id', ctm_activity_id, 'form_source', form_source, 'masked', masked)), '[]'::jsonb)
        FROM mops.form_sync_submissions WHERE property_id = pid AND qualification = 'needs_qualification' AND alerted_qualification_at IS NULL),
      'recipient', (SELECT u.email FROM mops.access_grants g JOIN auth.users u ON u.id = g.user_id WHERE g.revoked_at IS NULL LIMIT 1),
      'property_name', (SELECT name FROM public.properties WHERE id = pid));

  ELSIF _op = 'formsync_mark_alerted' THEN
    UPDATE mops.form_sync_submissions SET
      alerted_unconfirmed_at = CASE WHEN _args->>'kind' = 'unconfirmed' THEN now() ELSE alerted_unconfirmed_at END,
      alerted_qualification_at = CASE WHEN _args->>'kind' = 'unqualified' THEN now() ELSE alerted_qualification_at END
    WHERE id IN (SELECT (jsonb_array_elements_text(_args->'ids'))::uuid);
    RETURN jsonb_build_object('ok', true);
  END IF;
  RETURN jsonb_build_object('error','unknown op');
END $$;
REVOKE ALL ON FUNCTION mops.formsync_core(uuid,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Scheduled entry point: engine ops only. No approvals, no review overrides, no list of other locations' data beyond work rows.
CREATE OR REPLACE FUNCTION public.mops_formsync_internal(_op text, _args jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF _op NOT IN ('formsync_config','formsync_scheduled_locations','formsync_ingest','formsync_run_failed','formsync_set','formsync_work',
                 'formsync_claim','formsync_qualify','formsync_alerts','formsync_mark_alerted') THEN
    RETURN jsonb_build_object('error','not_found');
  END IF;
  IF _op = 'formsync_set' AND coalesce((_args->>'review')::boolean,false) THEN RETURN jsonb_build_object('error','not_found'); END IF;
  IF _op NOT IN ('formsync_work','formsync_config','formsync_scheduled_locations','formsync_alerts') THEN
    INSERT INTO mops.audit_log (actor, endpoint, op, target, outcome) VALUES (NULL, 'mops-form-sync:scheduled', _op, coalesce(_args->>'property_id', _args->>'id'), 'allowed');
  END IF;
  RETURN mops.formsync_core(NULL, _op, _args);
END $$;
REVOKE ALL ON FUNCTION public.mops_formsync_internal(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mops_formsync_internal(text,jsonb) TO service_role;