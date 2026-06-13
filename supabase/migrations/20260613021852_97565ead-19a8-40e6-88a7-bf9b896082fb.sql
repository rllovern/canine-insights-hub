CREATE OR REPLACE FUNCTION public.rebuild_lead_facts(_property_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _written int := 0;
  _min_answered_call_seconds int := 30;
BEGIN
  DELETE FROM public.ghl_lead_facts WHERE property_id = _property_id;

  WITH
  out_agg AS (
    SELECT
      m.contact_id,
      MIN(m.sent_at) FILTER (WHERE m.direction = 'outbound')                                       AS first_any,
      MIN(m.sent_at) FILTER (WHERE m.direction = 'outbound' AND m.response_source = 'human')       AS first_human_out,
      MIN(m.sent_at) FILTER (WHERE m.direction = 'outbound' AND m.response_source = 'automation')  AS first_auto,
      MIN(m.sent_at) FILTER (WHERE m.direction = 'outbound' AND m.response_source = 'ai')          AS first_ai,
      COUNT(*) FILTER (WHERE m.direction = 'outbound' AND m.response_source = 'human')::int        AS human_attempts,
      COUNT(*) FILTER (WHERE m.direction = 'outbound' AND m.response_source = 'automation')::int   AS auto_touches,
      COUNT(*) FILTER (WHERE m.direction = 'outbound' AND m.response_source = 'ai')::int           AS ai_touches,
      COUNT(*) FILTER (WHERE m.direction = 'outbound')::int                                        AS total_touches,
      MAX(m.sent_at) FILTER (WHERE m.direction = 'outbound' AND m.response_source = 'human')       AS last_human_out_activity,
      MAX(m.sent_at)                                                                               AS last_activity,
      (ARRAY_AGG(m.channel ORDER BY m.sent_at)
        FILTER (WHERE m.direction = 'outbound' AND m.response_source = 'human'))[1]                AS first_human_channel
    FROM public.ghl_messages m
    WHERE m.property_id = _property_id AND m.contact_id IS NOT NULL
    GROUP BY m.contact_id
  ),
  inbound_call_seen AS (
    SELECT
      m.contact_id,
      COUNT(*)::int AS inbound_call_count,
      MAX(COALESCE(NULLIF(m.meta->'call'->>'duration','')::int, 0)) AS max_seen_duration,
      MIN(m.sent_at) AS first_inbound_call_at,
      BOOL_OR(m.sent_at >= c.ghl_created_at) AS has_call_after_lead_created
    FROM public.ghl_messages m
    LEFT JOIN public.ghl_contacts c
      ON c.property_id = m.property_id AND c.ghl_contact_id = m.contact_id
    WHERE m.property_id = _property_id
      AND m.contact_id IS NOT NULL
      AND m.message_type = 'TYPE_CALL'
      AND m.direction = 'inbound'
    GROUP BY m.contact_id
  ),
  in_call_agg AS (
    SELECT
      m.contact_id,
      MIN(m.sent_at) AS first_answered_in,
      MAX(m.sent_at) AS last_answered_in,
      MAX(COALESCE(NULLIF(m.meta->'call'->>'duration','')::int, 0)) AS max_duration
    FROM public.ghl_messages m
    JOIN public.ghl_contacts c
      ON c.property_id = m.property_id AND c.ghl_contact_id = m.contact_id
    WHERE m.property_id = _property_id
      AND m.contact_id IS NOT NULL
      AND m.message_type = 'TYPE_CALL'
      AND m.direction = 'inbound'
      AND lower(COALESCE(m.meta->'call'->>'status', m.raw->>'status', '')) IN ('completed','answered','in-progress')
      AND COALESCE(NULLIF(m.meta->'call'->>'duration','')::int, 0) >= _min_answered_call_seconds
      AND m.sent_at >= c.ghl_created_at
    GROUP BY m.contact_id
  ),
  appt_agg AS (
    SELECT
      a.contact_id,
      MIN(a.starts_at)                                                  AS booked_at,
      MIN(a.starts_at) FILTER (WHERE a.appointment_status = 'showed')   AS showed_at,
      MIN(a.starts_at) FILTER (WHERE a.appointment_status = 'no_show')  AS no_show_at
    FROM public.ghl_appointments a
    WHERE a.property_id = _property_id AND a.contact_id IS NOT NULL
    GROUP BY a.contact_id
  ),
  base AS (
    SELECT
      c.ghl_contact_id                                            AS contact_id,
      c.ghl_created_at                                            AS lead_created_at,
      o.ghl_opportunity_id                                        AS opportunity_id,
      COALESCE(o.assigned_to, c.assigned_user_id, c.assigned_to)  AS assigned_user_id,
      o.pipeline_id, o.stage_id,
      o.status                                                    AS opp_status,
      o.monetary_value, o.lost_reason_raw, o.lost_reason_normalized,
      o.won_at, o.lost_at
    FROM public.ghl_contacts c
    LEFT JOIN public.ghl_opportunities o
      ON o.property_id = c.property_id AND o.contact_id = c.ghl_contact_id
    WHERE c.property_id = _property_id AND c.ghl_created_at IS NOT NULL
  ),
  resolved AS (
    SELECT
      b.*,
      m.canonical_stage,
      COALESCE(m.suppresses_needs_first_response,
               m.canonical_stage IN ('contacted','engaged','appointment','showed','won'),
               false) AS handled_by_stage,
      oa.first_any, oa.first_human_out, oa.first_auto, oa.first_ai,
      oa.first_human_channel, oa.human_attempts, oa.auto_touches, oa.ai_touches, oa.total_touches,
      oa.last_human_out_activity, oa.last_activity,
      ica.first_answered_in, ica.last_answered_in, ica.max_duration,
      ics.inbound_call_count, ics.max_seen_duration, ics.first_inbound_call_at, ics.has_call_after_lead_created,
      LEAST(oa.first_human_out, ica.first_answered_in) AS first_engagement,
      GREATEST(oa.last_human_out_activity, ica.last_answered_in) AS last_human_act,
      aa.booked_at, aa.showed_at, aa.no_show_at
    FROM base b
    LEFT JOIN out_agg    oa  ON oa.contact_id  = b.contact_id
    LEFT JOIN in_call_agg ica ON ica.contact_id = b.contact_id
    LEFT JOIN inbound_call_seen ics ON ics.contact_id = b.contact_id
    LEFT JOIN appt_agg   aa  ON aa.contact_id  = b.contact_id
    LEFT JOIN public.property_pipeline_mapping m
      ON m.property_id = _property_id AND m.ghl_stage_id = b.stage_id
  )
  INSERT INTO public.ghl_lead_facts (
    property_id, contact_id, opportunity_id, assigned_user_id,
    pipeline_id, stage_id, canonical_stage, lead_created_at,
    first_any_response_at, first_human_response_at, first_automation_response_at, first_ai_response_at,
    first_human_response_channel,
    first_human_outbound_at, first_human_answered_inbound_at, first_human_engagement_at,
    first_human_engagement_type, human_call_duration_seconds,
    human_speed_to_lead_seconds_raw,
    human_attempt_count, automation_touch_count, ai_touch_count, total_touch_count,
    appointment_booked_at, appointment_showed_at, appointment_no_show_at,
    won_at, lost_at, lost_reason_raw, lost_reason_normalized, monetary_value,
    is_open, last_human_activity_at, last_activity_at,
    handled_by_stage, needs_first_response, needs_first_response_reason
  )
  SELECT
    _property_id, r.contact_id, r.opportunity_id, r.assigned_user_id,
    r.pipeline_id, r.stage_id, r.canonical_stage, r.lead_created_at,
    r.first_any, r.first_engagement, r.first_auto, r.first_ai,
    r.first_human_channel,
    r.first_human_out, r.first_answered_in, r.first_engagement,
    CASE
      WHEN r.first_engagement IS NULL THEN NULL
      WHEN r.first_human_out IS NOT NULL AND (r.first_answered_in IS NULL OR r.first_human_out <= r.first_answered_in)
        THEN COALESCE('outbound_' || r.first_human_channel, 'outbound')
      ELSE 'answered_inbound_call'
    END,
    r.max_duration,
    CASE WHEN r.first_engagement IS NOT NULL
      THEN GREATEST(0, EXTRACT(EPOCH FROM (r.first_engagement - r.lead_created_at))::int)
      ELSE NULL END,
    COALESCE(r.human_attempts, 0) + CASE WHEN r.first_answered_in IS NOT NULL THEN 1 ELSE 0 END,
    COALESCE(r.auto_touches,   0),
    COALESCE(r.ai_touches,     0),
    COALESCE(r.total_touches,  0),
    r.booked_at, r.showed_at, r.no_show_at,
    r.won_at, r.lost_at, r.lost_reason_raw, r.lost_reason_normalized, r.monetary_value,
    CASE WHEN r.opp_status IN ('won','lost','abandoned') THEN false ELSE true END,
    r.last_human_act,
    GREATEST(r.last_activity, r.last_answered_in, r.first_inbound_call_at),
    r.handled_by_stage,
    (CASE WHEN r.opp_status IN ('won','lost','abandoned') THEN false ELSE true END)
      AND r.first_engagement IS NULL
      AND NOT r.handled_by_stage,
    CASE
      WHEN r.contact_id IS NULL OR length(r.contact_id) = 0 THEN 'Missing contact link'
      WHEN r.opp_status IN ('won','lost','abandoned') THEN 'Lead is closed'
      WHEN r.first_answered_in IS NOT NULL THEN 'Answered inbound call >= 30 seconds'
      WHEN r.first_human_out IS NOT NULL THEN 'Outbound human response exists'
      WHEN r.handled_by_stage THEN 'Stage suppresses needs first response'
      WHEN COALESCE(r.inbound_call_count, 0) > 0 AND COALESCE(r.max_seen_duration, 0) < _min_answered_call_seconds THEN 'Call exists but under 30 seconds'
      WHEN COALESCE(r.inbound_call_count, 0) > 0 AND NOT COALESCE(r.has_call_after_lead_created, false) THEN 'Call exists but before lead created timestamp'
      WHEN r.stage_id IS NOT NULL AND r.canonical_stage IS NULL THEN 'Stage is unconfirmed/unhandled'
      WHEN r.assigned_user_id IS NULL THEN 'No assigned agent · no outbound human response · no answered inbound call'
      ELSE 'No outbound human response · no answered inbound call'
    END
  FROM resolved r;

  GET DIAGNOSTICS _written = ROW_COUNT;

  WITH eng AS (
    SELECT contact_id, first_human_engagement_at AS first_human, last_human_activity_at AS last_human
    FROM public.ghl_lead_facts WHERE property_id = _property_id
  ),
  latest_opp AS (
    SELECT DISTINCT ON (contact_id) contact_id, ghl_opportunity_id
    FROM public.ghl_opportunities WHERE property_id = _property_id AND contact_id IS NOT NULL
    ORDER BY contact_id, ghl_created_at DESC NULLS LAST
  )
  UPDATE public.ghl_contacts c
  SET first_human_response_at  = eng.first_human,
      latest_human_response_at = eng.last_human,
      has_opportunity          = (lo.ghl_opportunity_id IS NOT NULL),
      latest_opportunity_id    = lo.ghl_opportunity_id
  FROM (SELECT c2.ghl_contact_id FROM public.ghl_contacts c2 WHERE c2.property_id = _property_id) ids
  LEFT JOIN eng        ON eng.contact_id    = ids.ghl_contact_id
  LEFT JOIN latest_opp lo ON lo.contact_id  = ids.ghl_contact_id
  WHERE c.property_id = _property_id AND c.ghl_contact_id = ids.ghl_contact_id;

  WITH grp AS (
    SELECT ghl_contact_id,
      COALESCE(
        NULLIF(regexp_replace(COALESCE(phone,''), '[^0-9]', '', 'g'), ''),
        lower(NULLIF(COALESCE(email,''), ''))
      ) AS key
    FROM public.ghl_contacts WHERE property_id = _property_id
  ),
  dupkeys AS (
    SELECT key FROM grp WHERE key IS NOT NULL GROUP BY key HAVING COUNT(*) > 1
  )
  UPDATE public.ghl_contacts c
  SET duplicate_group_id = CASE WHEN g.key IN (SELECT key FROM dupkeys) THEN g.key ELSE NULL END
  FROM grp g
  WHERE c.property_id = _property_id AND c.ghl_contact_id = g.ghl_contact_id;

  RETURN jsonb_build_object('facts_written', _written);
END;
$function$;