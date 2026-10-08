CREATE FUNCTION mops.refresh_signals() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _sig (property_id uuid, signal_key text, state text, reason text) ON COMMIT DROP;
  DELETE FROM _sig;

  INSERT INTO _sig
  SELECT DISTINCT p.id, 'incident_' || i.source, 'action_required', 'Open ' || i.source || ' data incident since ' || to_char(i.opened_at, 'Mon DD')
  FROM public.data_source_incidents i
  JOIN public.properties p ON p.id = ANY(i.affected_property_ids)
  WHERE i.resolved_at IS NULL AND coalesce(i.muted,false) = false;

  INSERT INTO _sig
  SELECT d.property_id, 'spend_stopped', 'action_required',
         'No ad spend for 3 days (prior average $' || round(avg_prior)::text || '/day)'
  FROM (
    SELECT property_id,
      sum(cost) FILTER (WHERE date BETWEEN current_date - 3 AND current_date - 1) AS recent,
      sum(cost) FILTER (WHERE date BETWEEN current_date - 17 AND current_date - 4) / 14.0 AS avg_prior
    FROM public.daily_metrics WHERE date >= current_date - 17
    GROUP BY property_id
  ) d
  JOIN public.properties p ON p.id = d.property_id AND p.is_active
  WHERE coalesce(d.avg_prior,0) >= 20 AND coalesce(d.recent,0) = 0;

  INSERT INTO _sig
  SELECT d.property_id, 'good_leads_down', 'observing',
         'Good leads ' || coalesce(recent,0) || ' in last 14 days vs ~' || round(base14) || ' typical'
  FROM (
    SELECT property_id,
      sum(good_leads) FILTER (WHERE date BETWEEN current_date - 14 AND current_date - 1) AS recent,
      sum(good_leads) FILTER (WHERE date BETWEEN current_date - 42 AND current_date - 15) / 2.0 AS base14,
      sum(good_leads) FILTER (WHERE date BETWEEN current_date - 42 AND current_date - 15) AS base_n
    FROM public.daily_metrics WHERE date >= current_date - 42
    GROUP BY property_id
  ) d
  JOIN public.properties p ON p.id = d.property_id AND p.is_active
  WHERE coalesce(base_n,0) >= 10 AND coalesce(recent,0) <= base14 * 0.5;

  INSERT INTO _sig
  SELECT s.property_id, 'stale_' || s.source, 'observing', s.source || ' has not synced successfully in over 48 hours'
  FROM public.property_data_sources s
  JOIN public.properties p ON p.id = s.property_id AND p.is_active
  WHERE s.is_connected AND coalesce(s.alerts_muted,false) = false
    AND s.last_success_at < now() - interval '48 hours'
    AND NOT EXISTS (SELECT 1 FROM _sig x WHERE x.property_id = s.property_id AND x.signal_key = 'incident_' || s.source);

  UPDATE mops.ops_signals o SET resolved_at = now()
  WHERE o.resolved_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM _sig x WHERE x.property_id = o.property_id AND x.signal_key = o.signal_key);

  UPDATE mops.ops_signals o SET last_seen_at = now(), reason = x.reason, state = x.state
  FROM _sig x WHERE o.resolved_at IS NULL AND x.property_id = o.property_id AND x.signal_key = o.signal_key;

  INSERT INTO mops.ops_signals (property_id, signal_key, state, reason)
  SELECT x.property_id, x.signal_key, x.state, x.reason FROM _sig x
  WHERE NOT EXISTS (SELECT 1 FROM mops.ops_signals o WHERE o.resolved_at IS NULL AND o.property_id = x.property_id AND o.signal_key = x.signal_key)
    AND NOT (x.state = 'observing' AND EXISTS (SELECT 1 FROM mops.ops_signals o WHERE o.property_id = x.property_id AND o.signal_key = x.signal_key AND o.resolved_at > now() - interval '2 days'))
  ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION mops.refresh_signals() FROM PUBLIC, anon, service_role;

CREATE FUNCTION mops.evidence(_pid uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'google_ads_connected', EXISTS (SELECT 1 FROM public.property_data_sources WHERE property_id = _pid AND source = 'google_ads' AND is_connected),
    'ad_spend_7d', (SELECT coalesce(sum(cost),0) FROM public.daily_metrics WHERE property_id = _pid AND date >= current_date - 7),
    'ctm_connected', EXISTS (SELECT 1 FROM public.property_data_sources WHERE property_id = _pid AND source = 'ctm' AND is_connected),
    'ctm_calls_14d', (SELECT count(*) FROM public.ctm_calls WHERE property_id = _pid AND called_at >= now() - interval '14 days'),
    'ghl_connected', EXISTS (SELECT 1 FROM public.property_data_sources WHERE property_id = _pid AND source = 'ghl' AND is_connected),
    'ghl_contacts_14d', (SELECT count(*) FROM public.ghl_contacts WHERE property_id = _pid AND ghl_created_at >= now() - interval '14 days'),
    'budget_set', EXISTS (SELECT 1 FROM public.campaign_budgets WHERE property_id = _pid) OR EXISTS (SELECT 1 FROM public.budget_accounts WHERE property_id = _pid)
  )
$$;
REVOKE ALL ON FUNCTION mops.evidence(uuid) FROM PUBLIC, anon, service_role;

CREATE FUNCTION mops.auto_status(_key text, _ev jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE _key
    WHEN 'access_google_ads' THEN CASE WHEN (_ev->>'google_ads_connected')::boolean THEN 'verified' END
    WHEN 'access_ctm' THEN CASE WHEN (_ev->>'ctm_connected')::boolean AND (_ev->>'ctm_calls_14d')::int > 0 THEN 'verified' END
    WHEN 'access_ghl' THEN CASE WHEN (_ev->>'ghl_connected')::boolean AND (_ev->>'ghl_contacts_14d')::int > 0 THEN 'verified' END
    WHEN 'gads_budget' THEN CASE WHEN (_ev->>'budget_set')::boolean THEN 'verified' END
    WHEN 'gads_ctm' THEN CASE WHEN (_ev->>'ctm_calls_14d')::int > 0 AND (_ev->>'ad_spend_7d')::numeric > 0 THEN 'awaiting_verification' END
    WHEN 'ctm_testing' THEN CASE WHEN (_ev->>'ctm_calls_14d')::int > 0 THEN 'awaiting_verification' END
    ELSE NULL END
$$;

CREATE FUNCTION public.mops_api(_actor uuid, _endpoint text, _op text, _args jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  pid uuid := nullif(_args->>'property_id','')::uuid;
  res jsonb;
  ev jsonb;
  locked boolean;
  last_brief timestamptz;
BEGIN
  IF NOT mops.check_grant(_actor) THEN
    INSERT INTO mops.audit_log (actor, endpoint, op, outcome) VALUES (_actor, _endpoint, _op, 'denied');
    RETURN jsonb_build_object('error','not_found');
  END IF;

  INSERT INTO mops.audit_log (actor, endpoint, op, target, outcome)
    VALUES (_actor, _endpoint, _op, coalesce(pid::text, _args->>'id'), 'allowed');

  IF _op = 'directory' THEN
    PERFORM mops.refresh_signals();
    SELECT jsonb_build_object(
      'locations', coalesce((SELECT jsonb_agg(row ORDER BY row->>'name') FROM (
        SELECT jsonb_build_object(
          'id', p.id, 'name', p.name, 'slug', p.slug, 'is_active', p.is_active,
          'classification', l.classification, 'stage', l.stage,
          'questionnaire_status', l.questionnaire_status,
          'ads_control', l.ads_control, 'billing_responsibility', l.billing_responsibility, 'billing_status', l.billing_status,
          'connections', (SELECT coalesce(jsonb_object_agg(s.source, jsonb_build_object('connected', s.is_connected, 'status', s.status, 'last_success_at', s.last_success_at)), '{}'::jsonb) FROM public.property_data_sources s WHERE s.property_id = p.id),
          'last_activity_at', greatest(l.last_activity_at, (SELECT max(created_at) FROM mops.journal_entries j WHERE j.property_id = p.id AND j.archived_at IS NULL)),
          'blocking', (SELECT count(*) FROM mops.client_requirements r WHERE r.property_id = p.id AND r.severity = 'blocking' AND r.status NOT IN ('verified','not_applicable')),
          'blocked', (SELECT count(*) FROM mops.client_requirements r WHERE r.property_id = p.id AND r.status = 'blocked'),
          'signals', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', o.signal_key, 'state', o.state, 'reason', o.reason)), '[]'::jsonb) FROM mops.ops_signals o WHERE o.property_id = p.id AND o.resolved_at IS NULL)
        ) AS row
        FROM public.properties p LEFT JOIN mops.client_lifecycle l ON l.property_id = p.id
      ) t), '[]'::jsonb),
      'prospects', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM mops.prospects x WHERE x.status = 'prospect'), '[]'::jsonb)
    ) INTO res;
    RETURN res;

  ELSIF _op = 'client' THEN
    IF pid IS NULL THEN RETURN jsonb_build_object('error','property_id required'); END IF;
    ev := mops.evidence(pid);
    SELECT (l.classification = 'onboarding' AND l.questionnaire_submitted_at IS NULL) INTO locked FROM mops.client_lifecycle l WHERE l.property_id = pid;
    SELECT jsonb_build_object(
      'property', (SELECT jsonb_build_object('id', id, 'name', name, 'slug', slug, 'is_active', is_active, 'timezone', timezone) FROM public.properties WHERE id = pid),
      'lifecycle', (SELECT to_jsonb(l) FROM mops.client_lifecycle l WHERE l.property_id = pid),
      'locked', coalesce(locked,false),
      'evidence', ev,
      'submission', (SELECT jsonb_build_object('status', s.status, 'submitted_at', s.submitted_at, 'answers', s.answers, 'updated_at', s.updated_at)
                     FROM public.onboarding_submissions s LEFT JOIN public.onboarding_invites i ON i.id = s.invite_id
                     WHERE coalesce(s.property_id, i.property_id) = pid ORDER BY s.updated_at DESC LIMIT 1),
      'invites', (SELECT coalesce(jsonb_agg(jsonb_build_object('status', status, 'contact_name', contact_name, 'contact_email', contact_email, 'last_sent_at', last_sent_at, 'created_at', created_at) ORDER BY created_at DESC), '[]'::jsonb) FROM public.onboarding_invites WHERE property_id = pid),
      'connections', (SELECT coalesce(jsonb_agg(jsonb_build_object('source', source, 'connected', is_connected, 'status', status, 'last_success_at', last_success_at, 'account', external_account_id)), '[]'::jsonb) FROM public.property_data_sources WHERE property_id = pid),
      'assets', (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.platform), '[]'::jsonb) FROM mops.client_assets a WHERE a.property_id = pid),
      'requirements', (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'key', c.key, 'area', c.area, 'title', c.title, 'sort', c.sort, 'verification', c.verification,
          'instructions', c.instructions, 'source_needed', c.source_needed,
          'status', coalesce(r.status, 'not_started'), 'auto_status', mops.auto_status(c.key, ev),
          'severity', coalesce(r.severity, 'warning'), 'note', r.note, 'tracked', r.id IS NOT NULL, 'updated_at', r.updated_at
        ) ORDER BY c.sort), '[]'::jsonb)
        FROM mops.requirement_catalog c LEFT JOIN mops.client_requirements r ON r.req_key = c.key AND r.property_id = pid),
      'decisions', (SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.decided_at DESC), '[]'::jsonb) FROM mops.requirement_decisions d WHERE d.property_id = pid),
      'form_config', (SELECT to_jsonb(f) FROM mops.form_integration_config f WHERE f.property_id = pid),
      'signals', (SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.opened_at DESC), '[]'::jsonb) FROM mops.ops_signals o WHERE o.property_id = pid AND (o.resolved_at IS NULL OR o.resolved_at > now() - interval '30 days'))
    ) INTO res;
    RETURN res;

  ELSIF _op = 'timeline' THEN
    IF pid IS NULL THEN RETURN jsonb_build_object('error','property_id required'); END IF;
    SELECT coalesce(jsonb_agg(t ORDER BY (t->>'at') DESC), '[]'::jsonb) INTO res FROM (
      SELECT jsonb_build_object('kind','note','id', j.id, 'at', j.created_at, 'updated_at', j.updated_at, 'body', j.body,
        'revisions', (SELECT count(*) FROM mops.journal_revisions v WHERE v.entry_id = j.id),
        'links', (SELECT coalesce(jsonb_agg(event_id), '[]'::jsonb) FROM mops.note_event_links k WHERE k.entry_id = j.id)) AS t
      FROM mops.journal_entries j WHERE j.property_id = pid AND j.archived_at IS NULL
        AND (_args->>'q' IS NULL OR j.body ILIKE '%' || (_args->>'q') || '%')
      UNION ALL
      SELECT jsonb_build_object('kind','ads_change','id', e.id, 'at', e.change_time, 'scope', e.scope,
        'attributed', e.property_id IS NOT NULL, 'resource_type', e.resource_type, 'operation', e.operation,
        'campaign', e.campaign_name, 'ad_group', e.ad_group_name, 'fields', e.changed_fields, 'user', e.user_email, 'client_type', e.client_type)
      FROM mops.ads_change_events e
      WHERE (e.property_id = pid OR (e.property_id IS NULL AND e.customer_id IN (SELECT external_account_id FROM public.property_data_sources WHERE property_id = pid AND source = 'google_ads')))
        AND (_args->>'q' IS NULL OR concat_ws(' ', e.resource_type, e.campaign_name, e.changed_fields) ILIKE '%' || (_args->>'q') || '%')
      UNION ALL
      SELECT jsonb_build_object('kind','incident','id', i.id, 'at', i.opened_at, 'source', i.source, 'resolved_at', i.resolved_at, 'error', left(i.first_error, 200))
      FROM public.data_source_incidents i WHERE pid = ANY(i.affected_property_ids) AND _args->>'q' IS NULL
      UNION ALL
      SELECT jsonb_build_object('kind','budget','id', b.id, 'at', b.created_at, 'effective_date', b.effective_date, 'monthly_budget', b.monthly_budget, 'previous_budget', b.previous_budget)
      FROM public.budget_change_log b WHERE b.property_id = pid AND _args->>'q' IS NULL
    ) x
    WHERE (_args->>'from' IS NULL OR (t->>'at')::timestamptz >= (_args->>'from')::timestamptz)
      AND (_args->>'to' IS NULL OR (t->>'at')::timestamptz < (_args->>'to')::timestamptz + interval '1 day');
    RETURN jsonb_build_object('items', (SELECT coalesce(jsonb_agg(v), '[]'::jsonb) FROM (SELECT v FROM jsonb_array_elements(res) v LIMIT 400) z));

  ELSIF _op = 'journal_create' THEN
    IF pid IS NULL OR length(coalesce(_args->>'body','')) = 0 THEN RETURN jsonb_build_object('error','text required'); END IF;
    INSERT INTO mops.journal_entries (property_id, body) VALUES (pid, _args->>'body') RETURNING to_jsonb(journal_entries.*) INTO res;
    UPDATE mops.client_lifecycle SET last_activity_at = now() WHERE property_id = pid;
    RETURN res;

  ELSIF _op = 'journal_update' THEN
    UPDATE mops.journal_entries SET body = _args->>'body' WHERE id = (_args->>'id')::uuid AND archived_at IS NULL
      RETURNING to_jsonb(journal_entries.*) INTO res;
    RETURN coalesce(res, jsonb_build_object('error','not_found'));

  ELSIF _op = 'journal_archive' THEN
    UPDATE mops.journal_entries SET archived_at = now() WHERE id = (_args->>'id')::uuid AND archived_at IS NULL RETURNING to_jsonb(journal_entries.*) INTO res;
    RETURN coalesce(res, jsonb_build_object('error','not_found'));

  ELSIF _op = 'journal_revisions' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('body', body, 'revised_at', revised_at) ORDER BY revised_at DESC), '[]'::jsonb) INTO res
    FROM mops.journal_revisions WHERE entry_id = (_args->>'id')::uuid;
    RETURN jsonb_build_object('revisions', res);

  ELSIF _op = 'link_event' THEN
    INSERT INTO mops.note_event_links (entry_id, event_id) VALUES ((_args->>'entry_id')::uuid, (_args->>'event_id')::uuid) ON CONFLICT DO NOTHING;
    RETURN jsonb_build_object('ok', true);

  ELSIF _op = 'lifecycle_update' THEN
    INSERT INTO mops.client_lifecycle (property_id, classification, questionnaire_status) VALUES (pid, 'legacy', 'unknown') ON CONFLICT DO NOTHING;
    UPDATE mops.client_lifecycle SET
      stage = coalesce(_args->>'stage', stage),
      ads_control = coalesce(_args->>'ads_control', ads_control),
      manager_linked = coalesce(_args->>'manager_linked', manager_linked),
      billing_responsibility = coalesce(_args->>'billing_responsibility', billing_responsibility),
      billing_status = coalesce(_args->>'billing_status', billing_status),
      management_responsibility = coalesce(_args->>'management_responsibility', management_responsibility),
      last_activity_at = now(), updated_at = now()
    WHERE property_id = pid RETURNING to_jsonb(client_lifecycle.*) INTO res;
    RETURN res;

  ELSIF _op = 'asset_upsert' THEN
    INSERT INTO mops.client_assets (property_id, platform, exists_state, controlled_by, access_status, external_id, note)
    VALUES (pid, _args->>'platform', coalesce(_args->>'exists_state','unknown'), coalesce(_args->>'controlled_by','unknown'),
            coalesce(_args->>'access_status','unknown'), nullif(_args->>'external_id',''), nullif(_args->>'note',''))
    ON CONFLICT (property_id, platform) DO UPDATE SET
      exists_state = EXCLUDED.exists_state, controlled_by = EXCLUDED.controlled_by, access_status = EXCLUDED.access_status,
      external_id = EXCLUDED.external_id, note = EXCLUDED.note, updated_at = now()
    RETURNING to_jsonb(client_assets.*) INTO res;
    UPDATE mops.client_lifecycle SET last_activity_at = now() WHERE property_id = pid;
    RETURN res;

  ELSIF _op = 'requirement_set' THEN
    INSERT INTO mops.client_requirements (property_id, req_key, status, severity, note)
    VALUES (pid, _args->>'key', coalesce(_args->>'status','not_started'), coalesce(_args->>'severity','warning'), nullif(_args->>'note',''))
    ON CONFLICT (property_id, req_key) DO UPDATE SET
      status = EXCLUDED.status,
      severity = coalesce(_args->>'severity', client_requirements.severity),
      note = coalesce(nullif(_args->>'note',''), client_requirements.note)
    RETURNING to_jsonb(client_requirements.*) INTO res;
    UPDATE mops.client_lifecycle SET last_activity_at = now() WHERE property_id = pid;
    RETURN res;

  ELSIF _op = 'decision_add' THEN
    INSERT INTO mops.requirement_decisions (property_id, req_key, resolution, reason, decided_by)
    VALUES (pid, _args->>'key', _args->>'resolution', nullif(_args->>'reason',''), _actor) RETURNING to_jsonb(requirement_decisions.*) INTO res;
    RETURN res;

  ELSIF _op = 'form_config_upsert' THEN
    INSERT INTO mops.form_integration_config (property_id) VALUES (pid) ON CONFLICT DO NOTHING;
    UPDATE mops.form_integration_config SET
      thank_you_slug = coalesce(_args->>'thank_you_slug', thank_you_slug),
      form_reactor_id = coalesce(_args->>'form_reactor_id', form_reactor_id),
      tracking_number = coalesce(_args->>'tracking_number', tracking_number),
      capture_host = coalesce(_args->>'capture_host', capture_host),
      default_form = coalesce(_args->>'default_form', default_form),
      snippet_installed = coalesce((_args->>'snippet_installed')::boolean, snippet_installed),
      redirect_configured = coalesce((_args->>'redirect_configured')::boolean, redirect_configured),
      thank_you_exists = coalesce((_args->>'thank_you_exists')::boolean, thank_you_exists),
      form_reactor_configured = coalesce((_args->>'form_reactor_configured')::boolean, form_reactor_configured),
      e2e_status = coalesce(_args->>'e2e_status', e2e_status),
      last_verified_at = CASE WHEN _args ? 'e2e_status' THEN now() ELSE last_verified_at END,
      updated_at = now()
    WHERE property_id = pid RETURNING to_jsonb(form_integration_config.*) INTO res;
    RETURN res;

  ELSIF _op = 'prospect_create' THEN
    INSERT INTO mops.prospects (name, city, state, contact_name, contact_email, notes)
    VALUES (_args->>'name', _args->>'city', _args->>'state', _args->>'contact_name', _args->>'contact_email', _args->>'notes')
    RETURNING to_jsonb(prospects.*) INTO res;
    RETURN res;

  ELSIF _op = 'prospect_update' THEN
    UPDATE mops.prospects SET
      name = coalesce(_args->>'name', name), notes = coalesce(_args->>'notes', notes),
      contact_name = coalesce(_args->>'contact_name', contact_name), contact_email = coalesce(_args->>'contact_email', contact_email),
      status = coalesce(_args->>'status', status),
      converted_property_id = coalesce(nullif(_args->>'converted_property_id','')::uuid, converted_property_id),
      updated_at = now()
    WHERE id = (_args->>'id')::uuid RETURNING to_jsonb(prospects.*) INTO res;
    RETURN coalesce(res, jsonb_build_object('error','not_found'));

  ELSIF _op = 'brief' THEN
    PERFORM mops.refresh_signals();
    SELECT max(at) INTO last_brief FROM mops.audit_log WHERE actor = _actor AND op = 'brief' AND outcome = 'allowed' AND at < now() - interval '1 minute';
    SELECT jsonb_build_object(
      'last_reviewed_at', last_brief,
      'attention', (SELECT coalesce(jsonb_agg(jsonb_build_object('property_id', o.property_id, 'name', p.name, 'state', o.state, 'reason', o.reason, 'opened_at', o.opened_at, 'new', last_brief IS NULL OR o.opened_at > last_brief) ORDER BY (o.state = 'action_required') DESC, o.opened_at DESC), '[]'::jsonb)
                    FROM mops.ops_signals o JOIN public.properties p ON p.id = o.property_id WHERE o.resolved_at IS NULL),
      'resolved_recently', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'reason', o.reason, 'resolved_at', o.resolved_at)), '[]'::jsonb)
                    FROM mops.ops_signals o JOIN public.properties p ON p.id = o.property_id WHERE o.resolved_at > coalesce(last_brief, now() - interval '7 days')),
      'onboarding', (SELECT coalesce(jsonb_agg(jsonb_build_object('property_id', l.property_id, 'name', p.name, 'stage', l.stage, 'questionnaire_status', l.questionnaire_status,
                      'blocking', (SELECT count(*) FROM mops.client_requirements r WHERE r.property_id = l.property_id AND r.severity = 'blocking' AND r.status NOT IN ('verified','not_applicable')),
                      'blocked', (SELECT coalesce(jsonb_agg(c.title), '[]'::jsonb) FROM mops.client_requirements r JOIN mops.requirement_catalog c ON c.key = r.req_key WHERE r.property_id = l.property_id AND r.status = 'blocked'))), '[]'::jsonb)
                    FROM mops.client_lifecycle l JOIN public.properties p ON p.id = l.property_id WHERE l.classification = 'onboarding' AND l.stage NOT IN ('active','archived','paused')),
      'changes_7d', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', coalesce(p.name, 'Account-wide (' || e.customer_id || ')'), 'count', e.n, 'latest', e.latest)), '[]'::jsonb)
                    FROM (SELECT property_id, customer_id, count(*) n, max(change_time) latest FROM mops.ads_change_events WHERE change_time > now() - interval '7 days' GROUP BY 1,2) e
                    LEFT JOIN public.properties p ON p.id = e.property_id),
      'change_sync', (SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) FROM mops.ads_change_sync_state s WHERE s.consecutive_failures > 0 OR s.gap_note IS NOT NULL),
      'prospects', (SELECT count(*) FROM mops.prospects WHERE status = 'prospect'),
      'healthy_count', (SELECT count(*) FROM public.properties p WHERE p.is_active AND NOT EXISTS (SELECT 1 FROM mops.ops_signals o WHERE o.property_id = p.id AND o.resolved_at IS NULL))
    ) INTO res;
    RETURN res;

  ELSIF _op = 'ai_context' THEN
    IF (SELECT count(*) FROM mops.ai_usage WHERE actor = _actor AND at > now() - interval '1 day') >= 30 THEN
      RETURN jsonb_build_object('error','daily_limit');
    END IF;
    INSERT INTO mops.ai_usage (actor, property_id) VALUES (_actor, pid);
    SELECT jsonb_build_object(
      'name', (SELECT name FROM public.properties WHERE id = pid),
      'lifecycle', (SELECT to_jsonb(l) - 'property_id' FROM mops.client_lifecycle l WHERE l.property_id = pid),
      'signals', (SELECT coalesce(jsonb_agg(jsonb_build_object('state', state, 'reason', reason, 'opened_at', opened_at, 'resolved_at', resolved_at)), '[]'::jsonb) FROM mops.ops_signals WHERE property_id = pid AND opened_at > now() - interval '60 days'),
      'notes', (SELECT coalesce(jsonb_agg(jsonb_build_object('at', created_at, 'body', left(body, 1500)) ORDER BY created_at DESC), '[]'::jsonb) FROM (SELECT * FROM mops.journal_entries WHERE property_id = pid AND archived_at IS NULL ORDER BY created_at DESC LIMIT 25) j),
      'changes', (SELECT coalesce(jsonb_agg(jsonb_build_object('at', change_time, 'type', resource_type, 'op', operation, 'campaign', campaign_name, 'fields', left(changed_fields, 200))), '[]'::jsonb) FROM (SELECT * FROM mops.ads_change_events WHERE property_id = pid AND change_time > now() - interval '30 days' ORDER BY change_time DESC LIMIT 60) e),
      'weekly', (SELECT coalesce(jsonb_agg(w ORDER BY w->>'week'), '[]'::jsonb) FROM (SELECT jsonb_build_object('week', date_trunc('week', date)::date, 'spend', round(sum(cost)), 'leads', sum(leads), 'good_leads', sum(good_leads), 'records', sum(record_count)) w FROM public.daily_metrics WHERE property_id = pid AND date > current_date - 56 GROUP BY date_trunc('week', date)) z)
    ) INTO res;
    RETURN res;

  ELSIF _op = 'ai_record' THEN
    UPDATE mops.ai_usage SET chars = coalesce((_args->>'chars')::int, 0) WHERE id = (SELECT max(id) FROM mops.ai_usage WHERE actor = _actor);
    RETURN jsonb_build_object('ok', true);
  END IF;

  RETURN jsonb_build_object('error','unknown_op');
END $$;
REVOKE ALL ON FUNCTION public.mops_api(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mops_api(uuid, text, text, jsonb) TO service_role;

CREATE FUNCTION public.mops_audit_event(_actor uuid, _endpoint text, _outcome text, _detail jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO mops.audit_log (actor, endpoint, outcome, detail)
  VALUES (_actor, left(_endpoint, 80), CASE WHEN _outcome IN ('denied','error') THEN _outcome ELSE 'error' END, _detail)
$$;
REVOKE ALL ON FUNCTION public.mops_audit_event(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mops_audit_event(uuid, text, text, jsonb) TO service_role;

CREATE FUNCTION public.mops_ingest_changes(_customer text, _events jsonb, _through timestamptz, _ok boolean, _error text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n int := 0; prev timestamptz;
BEGIN
  IF _customer !~ '^[0-9]{6,12}$' THEN RAISE EXCEPTION 'bad customer'; END IF;
  SELECT last_success_through INTO prev FROM mops.ads_change_sync_state WHERE customer_id = _customer;
  IF _ok THEN
    WITH ins AS (
      INSERT INTO mops.ads_change_events (customer_id, change_time, resource_name, operation, resource_type, scope, campaign_id, campaign_name, ad_group_name, property_id, user_email, client_type, changed_fields, raw)
      SELECT _customer, (e->>'change_time')::timestamptz, e->>'resource_name', coalesce(e->>'operation',''), e->>'resource_type',
             CASE WHEN e->>'scope' = 'campaign' THEN 'campaign' ELSE 'account' END,
             e->>'campaign_id', e->>'campaign_name', e->>'ad_group_name',
             (SELECT s.property_id FROM public.property_data_sources s WHERE s.source = 'google_ads' AND s.external_account_id = _customer AND s.property_id = nullif(e->>'property_id','')::uuid LIMIT 1),
             e->>'user_email', e->>'client_type', e->>'changed_fields', e
      FROM jsonb_array_elements(coalesce(_events, '[]'::jsonb)) e
      WHERE e->>'resource_name' IS NOT NULL AND e->>'change_time' IS NOT NULL
      ON CONFLICT DO NOTHING RETURNING 1)
    SELECT count(*) INTO n FROM ins;
    INSERT INTO mops.ads_change_sync_state (customer_id, last_success_through, last_attempt_at, consecutive_failures, last_error, gap_note)
    VALUES (_customer, _through, now(), 0, NULL,
            CASE WHEN prev IS NOT NULL AND prev < now() - interval '30 days' THEN 'History between ' || to_char(prev, 'YYYY-MM-DD') || ' and ' || to_char(now() - interval '30 days', 'YYYY-MM-DD') || ' was beyond Google''s 30-day window and could not be recovered.' END)
    ON CONFLICT (customer_id) DO UPDATE SET last_success_through = EXCLUDED.last_success_through, last_attempt_at = now(),
      consecutive_failures = 0, last_error = NULL, gap_note = coalesce(EXCLUDED.gap_note, mops.ads_change_sync_state.gap_note);
  ELSE
    INSERT INTO mops.ads_change_sync_state (customer_id, last_attempt_at, consecutive_failures, last_error)
    VALUES (_customer, now(), 1, left(_error, 500))
    ON CONFLICT (customer_id) DO UPDATE SET last_attempt_at = now(), consecutive_failures = mops.ads_change_sync_state.consecutive_failures + 1, last_error = left(_error, 500);
  END IF;
  INSERT INTO mops.audit_log (actor_label, endpoint, op, target, outcome, detail)
  VALUES ('system:ads-changes-cron', 'mops-ads-changes-sync', 'ingest', _customer, CASE WHEN _ok THEN 'system' ELSE 'error' END, jsonb_build_object('inserted', n));
  RETURN jsonb_build_object('inserted', n);
END $$;
REVOKE ALL ON FUNCTION public.mops_ingest_changes(text, jsonb, timestamptz, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mops_ingest_changes(text, jsonb, timestamptz, boolean, text) TO service_role;

CREATE FUNCTION public.mops_change_sync_state() RETURNS TABLE(customer_id text, last_success_through timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$ SELECT customer_id, last_success_through FROM mops.ads_change_sync_state $$;
REVOKE ALL ON FUNCTION public.mops_change_sync_state() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mops_change_sync_state() TO service_role;

CREATE FUNCTION public.mops_privilege_audit() RETURNS TABLE(finding text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT 'schema usage: ' || r FROM unnest(ARRAY['anon','authenticated']) r WHERE has_schema_privilege(r, 'mops', 'USAGE')
  UNION ALL
  SELECT 'table ' || c.relname || ' ' || r || ' ' || p FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN unnest(ARRAY['anon','authenticated']) r CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p
    WHERE n.nspname = 'mops' AND c.relkind = 'r' AND has_table_privilege(r, c.oid, p)
  UNION ALL
  SELECT 'rls off: ' || c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'mops' AND c.relkind = 'r' AND NOT c.relrowsecurity
  UNION ALL
  SELECT 'public fn executable by ' || r || ': ' || f FROM unnest(ARRAY['public.mops_api(uuid,text,text,jsonb)','public.mops_audit_event(uuid,text,text,jsonb)','public.mops_ingest_changes(text,jsonb,timestamptz,boolean,text)','public.mops_change_sync_state()','public.mops_privilege_audit()']) f
    CROSS JOIN unnest(ARRAY['anon','authenticated']) r WHERE has_function_privilege(r, f::regprocedure, 'EXECUTE')
  UNION ALL
  SELECT 'unexpected function reading mops: ' || n.nspname || '.' || p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('mops','pg_catalog','information_schema') AND p.prosrc ILIKE '%mops.%'
      AND p.proname NOT IN ('mops_api','mops_my_access','mops_audit_event','mops_ingest_changes','mops_change_sync_state','mops_privilege_audit')
  UNION ALL
  SELECT 'active grants != 1' WHERE (SELECT count(*) FROM mops.access_grants WHERE revoked_at IS NULL) <> 1
$$;
REVOKE ALL ON FUNCTION public.mops_privilege_audit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mops_privilege_audit() TO service_role;