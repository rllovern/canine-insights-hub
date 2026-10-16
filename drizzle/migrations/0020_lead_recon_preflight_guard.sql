CREATE OR REPLACE FUNCTION mops.recon_preflight_guard(_args jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pid uuid := nullif(_args->>'property_id','')::uuid; r jsonb := coalesce(_args->'reasons','[]'::jsonb); ok boolean := coalesce((_args->>'passed')::boolean,false);
BEGIN
  -- A FormReactor already used by another location is never accepted.
  IF ok AND nullif(_args->>'frt','') IS NOT NULL AND EXISTS (SELECT 1 FROM mops.form_sync_config o WHERE o.property_id <> pid AND o.ctm_form_reactor_id = _args->>'frt') THEN
    ok := false; r := r || '["CTM FormReactor: already belongs to another location"]'::jsonb;
  END IF;
  -- At least one inquiry form must be fully ready (including manual reviews).
  IF ok AND NOT EXISTS (SELECT 1 FROM mops.recon_forms f WHERE f.property_id = pid AND f.classification = 'inquiry' AND f.form_source IS NOT NULL AND f.message_key IS NOT NULL) THEN
    ok := false; r := r || '["Ready inquiry form: no inquiry form has both a known source and a detected message field — review forms"]'::jsonb;
  END IF;
  RETURN _args || jsonb_build_object('passed', ok, 'reasons', r);
END $$;
REVOKE ALL ON FUNCTION mops.recon_preflight_guard(jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mops_formsync_api(_actor uuid, _endpoint text, _op text, _args jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT mops.check_grant(_actor) OR _op NOT LIKE 'formsync\_%' THEN
    INSERT INTO mops.audit_log (actor, endpoint, op, outcome) VALUES (_actor, _endpoint, _op, 'denied');
    RETURN jsonb_build_object('error','not_found');
  END IF;
  INSERT INTO mops.audit_log (actor, endpoint, op, target, outcome) VALUES (_actor, _endpoint, _op, coalesce(_args->>'property_id', _args->>'id'), 'allowed');
  IF _op = 'formsync_claimed' THEN RETURN mops.formsync_claimed((_args->>'property_id')::uuid); END IF;
  IF _op = 'formsync_recon_preflight_save' THEN RETURN mops.recon_core(_actor, _op, mops.recon_preflight_guard(_args)); END IF;
  IF _op LIKE 'formsync\_recon\_%' THEN RETURN mops.recon_core(_actor, _op, _args); END IF;
  RETURN mops.formsync_core(_actor, _op, _args);
END $$;

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
  IF _op = 'formsync_recon_preflight_save' THEN RETURN mops.recon_core(NULL, _op, mops.recon_preflight_guard(_args)); END IF;
  IF _op LIKE 'formsync\_recon\_%' THEN RETURN mops.recon_core(NULL, _op, _args); END IF;
  IF _op = 'formsync_scheduled_locations' THEN
    RETURN jsonb_build_object('locations', (SELECT coalesce(jsonb_agg(property_id), '[]'::jsonb) FROM mops.form_sync_config WHERE schedule_enabled AND mode IN ('monitor','live') AND NOT manual_hold));
  END IF;
  RETURN mops.formsync_core(NULL, _op, _args);
END $$;
