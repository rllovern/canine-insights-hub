-- CTM activity IDs already tied to a submission at this location, so the matcher never reuses them.
CREATE OR REPLACE FUNCTION mops.formsync_claimed(_pid uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('claimed', coalesce(jsonb_agg(DISTINCT ctm_activity_id), '[]'::jsonb))
  FROM mops.form_sync_submissions WHERE property_id = _pid AND ctm_activity_id IS NOT NULL
$$;
REVOKE ALL ON FUNCTION mops.formsync_claimed(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mops_formsync_api(_actor uuid, _endpoint text, _op text, _args jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT mops.check_grant(_actor) OR _op NOT LIKE 'formsync\_%' THEN
    INSERT INTO mops.audit_log (actor, endpoint, op, outcome) VALUES (_actor, _endpoint, _op, 'denied');
    RETURN jsonb_build_object('error','not_found');
  END IF;
  INSERT INTO mops.audit_log (actor, endpoint, op, target, outcome) VALUES (_actor, _endpoint, _op, coalesce(_args->>'property_id', _args->>'id'), 'allowed');
  IF _op = 'formsync_claimed' THEN RETURN mops.formsync_claimed((_args->>'property_id')::uuid); END IF;
  RETURN mops.formsync_core(_actor, _op, _args);
END $$;
REVOKE ALL ON FUNCTION public.mops_formsync_api(uuid,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mops_formsync_api(uuid,text,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.mops_formsync_internal(_op text, _args jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF _op NOT IN ('formsync_config','formsync_scheduled_locations','formsync_ingest','formsync_run_failed','formsync_set','formsync_work',
                 'formsync_claim','formsync_claimed','formsync_qualify','formsync_alerts','formsync_mark_alerted') THEN
    RETURN jsonb_build_object('error','not_found');
  END IF;
  IF _op = 'formsync_set' AND coalesce((_args->>'review')::boolean,false) THEN RETURN jsonb_build_object('error','not_found'); END IF;
  IF _op NOT IN ('formsync_work','formsync_config','formsync_scheduled_locations','formsync_alerts','formsync_claimed') THEN
    INSERT INTO mops.audit_log (actor, endpoint, op, target, outcome) VALUES (NULL, 'mops-form-sync:scheduled', _op, coalesce(_args->>'property_id', _args->>'id'), 'allowed');
  END IF;
  IF _op = 'formsync_claimed' THEN RETURN mops.formsync_claimed((_args->>'property_id')::uuid); END IF;
  RETURN mops.formsync_core(NULL, _op, _args);
END $$;
REVOKE ALL ON FUNCTION public.mops_formsync_internal(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mops_formsync_internal(text,jsonb) TO service_role;