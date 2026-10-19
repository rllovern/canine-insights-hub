ALTER TABLE mops.form_sync_config ADD COLUMN production_watch_limit integer NOT NULL DEFAULT 0, ADD COLUMN safety_alert_pending boolean NOT NULL DEFAULT false;
ALTER TABLE mops.form_sync_submissions ADD COLUMN production_evidence jsonb;
CREATE FUNCTION mops.formsync_safety(_actor uuid, _args jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE pid uuid := nullif(_args->>'property_id','')::uuid; a text := _args->>'action'; cfg mops.form_sync_config; cutoff timestamptz; res jsonb;
BEGIN
 IF pid IS DISTINCT FROM 'a5f7eeea-dfe6-4ec2-a9eb-895d99c0c465'::uuid THEN RETURN jsonb_build_object('error','not_found'); END IF;
 SELECT * INTO cfg FROM mops.form_sync_config WHERE property_id=pid FOR UPDATE;
 IF a='activate' THEN
  IF _actor IS NULL OR NOT mops.check_grant(_actor) THEN RETURN jsonb_build_object('error','not_found'); END IF;
  IF cfg.mode <> 'monitor' OR cfg.manual_hold OR cfg.preflight_status <> 'passed' OR NOT cfg.matching_verified OR NOT cfg.composite_match OR cfg.ctm_form_numeric_id <> '238734' OR cfg.message_field <> 'how_can_we_help_you' OR cfg.grace_minutes <> 15 OR jsonb_object_length(cfg.form_map) <> 2 THEN RETURN jsonb_build_object('error','NorCal safety checks failed'); END IF;
  cutoff := clock_timestamp();
  UPDATE mops.form_sync_config SET mode='live',delivery_enabled=true,schedule_enabled=true,activation_at=cutoff,production_watch_limit=5,readiness='approved_live',updated_at=cutoff WHERE property_id=pid;
  INSERT INTO mops.form_sync_attempts(submission_id,property_id,actor,kind,outcome,detail) SELECT id,pid,_actor,'hold','held',jsonb_build_object('reason','before_production_activation') FROM mops.form_sync_submissions WHERE property_id=pid AND submitted_at<cutoff AND status NOT IN ('matched','delivered','held');
  UPDATE mops.form_sync_submissions SET status='held',hold_reason='before_activation',updated_at=cutoff WHERE property_id=pid AND submitted_at<cutoff AND status NOT IN ('matched','delivered','held');
  INSERT INTO mops.form_sync_attempts(property_id,actor,kind,outcome,detail) VALUES(pid,_actor,'control','production_live_approved',jsonb_build_object('activation_at',cutoff,'watch_limit',5));
  RETURN jsonb_build_object('activation_at',cutoff,'live',true);
 END IF;
 IF cfg.production_watch_limit <> 5 THEN RETURN jsonb_build_object('error','not_found'); END IF;
 IF a='watch' THEN
  RETURN jsonb_build_object('submissions',(SELECT coalesce(jsonb_agg(to_jsonb(s)-'message_hash'-'lock_token' ORDER BY submitted_at,ghl_submission_id),'[]'::jsonb) FROM (SELECT * FROM mops.form_sync_submissions WHERE property_id=pid AND submitted_at>=cfg.activation_at AND cfg.form_map ? ghl_form_id ORDER BY submitted_at,ghl_submission_id LIMIT 5) s));
 ELSIF a='can_send' THEN
  RETURN jsonb_build_object('allowed',cfg.mode='live' AND cfg.delivery_enabled AND NOT cfg.manual_hold AND EXISTS(SELECT 1 FROM mops.form_sync_submissions WHERE id=(_args->>'id')::uuid AND property_id=pid AND submitted_at>=cfg.activation_at));
 ELSIF a='stop' THEN
  UPDATE mops.form_sync_config SET delivery_enabled=false,manual_hold=true,manual_hold_reason=left(_args->>'reason',500),safety_alert_pending=true,updated_at=now() WHERE property_id=pid;
  INSERT INTO mops.form_sync_attempts(property_id,actor,kind,outcome,detail) VALUES(pid,_actor,'safety','automatic_sending_paused',jsonb_build_object('reason',left(_args->>'reason',500)));
 ELSIF a='record' THEN
  UPDATE mops.form_sync_submissions SET production_evidence=_args->'evidence',qualification=CASE WHEN status IN ('matched','delivered') AND (coalesce((_args->'evidence'->>'inquiry_complete')::boolean,false)=false OR coalesce((_args->'evidence'->>'askai_verified')::boolean,false)=false) THEN 'needs_qualification' ELSE qualification END WHERE id=(_args->>'id')::uuid AND property_id=pid AND submitted_at>=cfg.activation_at;
 ELSIF a='alert' THEN
  RETURN jsonb_build_object('pending',cfg.safety_alert_pending,'reason',cfg.manual_hold_reason,'recipient',(SELECT u.email FROM mops.access_grants g JOIN auth.users u ON u.id=g.user_id WHERE g.revoked_at IS NULL LIMIT 1));
 ELSIF a='alerted' THEN
  UPDATE mops.form_sync_config SET safety_alert_pending=false WHERE property_id=pid;
 ELSE RETURN jsonb_build_object('error','not_found'); END IF;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION mops.formsync_safety(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.mops_formsync_api(_actor uuid,_endpoint text,_op text,_args jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT mops.check_grant(_actor) OR _op NOT LIKE 'formsync\_%' THEN INSERT INTO mops.audit_log(actor,endpoint,op,outcome) VALUES(_actor,_endpoint,_op,'denied'); RETURN jsonb_build_object('error','not_found'); END IF;
 INSERT INTO mops.audit_log(actor,endpoint,op,target,outcome) VALUES(_actor,_endpoint,_op,coalesce(_args->>'property_id',_args->>'id'),'allowed');
 IF _op='formsync_safety' THEN RETURN mops.formsync_safety(_actor,_args); END IF;
 IF _op='formsync_claimed' THEN RETURN mops.formsync_claimed((_args->>'property_id')::uuid); END IF;
 IF _op='formsync_recon_preflight_save' THEN RETURN mops.recon_core(_actor,_op,mops.recon_preflight_guard(_args)); END IF;
 IF _op LIKE 'formsync\_recon\_%' THEN RETURN mops.recon_core(_actor,_op,_args); END IF;
 RETURN mops.formsync_core(_actor,_op,_args);
END $$;
REVOKE ALL ON FUNCTION public.mops_formsync_api(uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mops_formsync_api(uuid,text,text,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.mops_formsync_internal(_op text,_args jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF _op='formsync_safety' THEN
  IF coalesce(_args->>'action','') NOT IN ('watch','can_send','stop','record','alert','alerted') THEN RETURN jsonb_build_object('error','not_found'); END IF;
  INSERT INTO mops.audit_log(actor,endpoint,op,target,outcome) VALUES(NULL,'mops-form-sync:scheduled',_op,_args->>'property_id','allowed');
  RETURN mops.formsync_safety(NULL,_args);
 END IF;
 IF _op NOT IN ('formsync_config','formsync_scheduled_locations','formsync_ingest','formsync_run_failed','formsync_set','formsync_work','formsync_claim','formsync_claimed','formsync_qualify','formsync_alerts','formsync_mark_alerted','formsync_recon_candidates','formsync_recon_forms_upsert','formsync_recon_preflight_save','formsync_recon_calls_check','formsync_recon_runtime','formsync_recon_alert_items','formsync_recon_mark_alert') THEN RETURN jsonb_build_object('error','not_found'); END IF;
 IF _op='formsync_set' AND coalesce((_args->>'review')::boolean,false) THEN RETURN jsonb_build_object('error','not_found'); END IF;
 IF _op NOT IN ('formsync_work','formsync_config','formsync_scheduled_locations','formsync_alerts','formsync_claimed','formsync_recon_candidates','formsync_recon_runtime','formsync_recon_alert_items') THEN INSERT INTO mops.audit_log(actor,endpoint,op,target,outcome) VALUES(NULL,'mops-form-sync:scheduled',_op,coalesce(_args->>'property_id',_args->>'id'),'allowed'); END IF;
 IF _op='formsync_claimed' THEN RETURN mops.formsync_claimed((_args->>'property_id')::uuid); END IF;
 IF _op='formsync_recon_preflight_save' THEN RETURN mops.recon_core(NULL,_op,mops.recon_preflight_guard(_args)); END IF;
 IF _op LIKE 'formsync\_recon\_%' THEN RETURN mops.recon_core(NULL,_op,_args); END IF;
 IF _op='formsync_scheduled_locations' THEN RETURN jsonb_build_object('locations',(SELECT coalesce(jsonb_agg(property_id),'[]'::jsonb) FROM mops.form_sync_config WHERE schedule_enabled AND mode IN ('monitor','live') AND NOT manual_hold)); END IF;
 RETURN mops.formsync_core(NULL,_op,_args);
END $$;
REVOKE ALL ON FUNCTION public.mops_formsync_internal(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mops_formsync_internal(text,jsonb) TO service_role;