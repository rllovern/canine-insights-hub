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
  contact_tags AS (
    SELECT
      c.ghl_contact_id AS contact_id,
      COALESCE(c.tags, ARRAY[]::text[]) AS tag_names,
      COALESCE(
        ARRAY(
          SELECT DISTINCT t.label
          FROM unnest(COALESCE(c.tags, ARRAY[]::text[])) AS raw_tag
          JOIN public.lead_perf_suppression_tags t
            ON t.tag_normalized = public.normalize_tag(raw_tag)
        ),
        ARRAY[]::text[]
      ) AS suppressing
    FROM public.ghl_contacts c
    WHERE c.property_id = _property_id
  ),
  meaningful AS (
    SELECT DISTINCT ON (ev.property_id, ev.contact_id)
      ev.property_id, ev.contact_id, ev.ts, ev.kind
    FROM (
      SELECT
        m.property_id,
        m.contact_id,
        m.sent_at AS ts,
        CASE
          WHEN m.message_type = 'TYPE_CALL' AND m.direction = 'inbound' THEN
            CASE WHEN COALESCE(NULLIF(m.meta->'call'->>'duration','')::int, 0) >= 30
              THEN 'answered inbound call'
              WHEN lower(COALESCE(m.meta->'call'->>'status', m.raw->>'status','')) IN ('no-answer','voicemail','busy','failed','missed')
              THEN 'missed inbound call'
              ELSE 'inbound call' END
          WHEN m.message_type = 'TYPE_CALL' AND m.direction = 'outbound' THEN
            CASE WHEN lower(COALESCE(m.meta->'call'->>'status', m.raw->>'status','')) IN ('no-answer','voicemail','busy','failed')
              THEN 'outbound call, no answer'
              WHEN COALESCE(NULLIF(m.meta->'call'->>'duration','')::int, 0) >= 30
              THEN 'outbound call'
              ELSE 'outbound call attempt' END
          WHEN m.direction = 'inbound' AND m.channel = 'sms' THEN 'customer SMS'
          WHEN m.direction = 'inbound' AND m.channel = 'email' THEN 'customer email'
          WHEN m.direction = 'inbound' THEN 'message from lead'
          WHEN m.direction = 'outbound' AND m.response_source = 'human' THEN 'human ' || COALESCE(lower(m.channel), 'message')
          WHEN m.direction = 'outbound' AND m.response_source IN ('automation','ai') THEN 'automation ' || COALESCE(lower(m.channel), 'message')
          WHEN m.direction = 'outbound' THEN 'outbound ' || COALESCE(lower(m.channel), 'message')
          ELSE NULL
        END AS kind
      FROM public.ghl_messages m
      WHERE m.property_id = _property_id AND m.contact_id IS NOT NULL AND m.sent_at IS NOT NULL
        AND (m.direction IN ('inbound','outbound') OR m.message_type = 'TYPE_CALL')

      UNION ALL
      SELECT t.property_id, t.contact_id, t.completed_at AS ts, 'task completed' AS kind
      FROM public.ghl_tasks t
      WHERE t.property_id = _property_id AND t.contact_id IS NOT NULL AND t.completed_at IS NOT NULL

      UNION ALL
      SELECT a.property_id, a.contact_id, COALESCE(a.updated_at, a.starts_at) AS ts,
        CASE WHEN a.appointment_status::text = 'showed' THEN 'appointment showed'
             WHEN a.appointment_status::text = 'no_show' THEN 'appointment no-show'
             ELSE 'appointment updated' END AS kind
      FROM public.ghl_appointments a
      WHERE a.property_id = _property_id AND a.contact_id IS NOT NULL AND COALESCE(a.updated_at, a.starts_at) IS NOT NULL

      UNION ALL
      SELECT h.property_id, oo.contact_id, h.changed_at AS ts, 'stage change' AS kind
      FROM public.ghl_opportunity_stage_history h
      JOIN public.ghl_opportunities oo ON oo.id = h.opportunity_id
      WHERE h.property_id = _property_id AND oo.contact_id IS NOT NULL AND h.changed_at IS NOT NULL

      UNION ALL
      SELECT o.property_id, o.contact_id, o.ghl_updated_at AS ts, 'opportunity updated' AS kind
      FROM public.ghl_opportunities o
      WHERE o.property_id = _property_id AND o.contact_id IS NOT NULL AND o.ghl_updated_at IS NOT NULL
        AND (
          o.ghl_updated_at > o.ghl_created_at
          OR o.stage_id IS NOT NULL OR o.status IS NOT NULL OR o.monetary_value IS NOT NULL OR o.assigned_to IS NOT NULL
        )
    ) ev
    JOIN public.ghl_contacts c ON c.property_id = ev.property_id AND c.ghl_contact_id = ev.contact_id
    WHERE ev.ts IS NOT NULL AND ev.kind IS NOT NULL AND ev.ts >= c.ghl_created_at
    ORDER BY ev.property_id, ev.contact_id, ev.ts DESC
  ),
  base AS (
    SELECT
      c.ghl_contact_id                                            AS contact_id,
      c.ghl_created_at                                            AS lead_created_at,
      c.updated_at                                                AS contact_record_updated_at,
      pds.last_synced_at                                          AS last_synced_at,
      o.ghl_opportunity_id                                        AS opportunity_id,
      COALESCE(o.assigned_to, c.assigned_user_id, c.assigned_to)  AS assigned_user_id,
      o.pipeline_id, o.stage_id,
      o.status                                                    AS opp_status,
      o.monetary_value, o.lost_reason_raw, o.lost_reason_normalized,
      o.won_at, o.lost_at
    FROM public.ghl_contacts c
    LEFT JOIN public.ghl_opportunities o
      ON o.property_id = c.property_id AND o.contact_id = c.ghl_contact_id
    LEFT JOIN public.property_data_sources pds
      ON pds.property_id = c.property_id AND pds.source = 'ghl'
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
      aa.booked_at, aa.showed_at, aa.no_show_at,
      ct.tag_names, ct.suppressing,
      (array_length(ct.suppressing, 1) > 0) AS has_supp_tag,
      mf.ts AS last_meaningful_activity_at,
      mf.kind AS last_meaningful_activity_type
    FROM base b
    LEFT JOIN out_agg    oa  ON oa.contact_id  = b.contact_id
    LEFT JOIN in_call_agg ica ON ica.contact_id = b.contact_id
    LEFT JOIN inbound_call_seen ics ON ics.contact_id = b.contact_id
    LEFT JOIN appt_agg   aa  ON aa.contact_id = b.contact_id
    LEFT JOIN contact_tags ct ON ct.contact_id = b.contact_id
    LEFT JOIN meaningful mf ON mf.property_id = _property_id AND mf.contact_id = b.contact_id
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
    last_meaningful_activity_at, last_meaningful_activity_type,
    contact_record_updated_at, last_synced_at,
    handled_by_stage,
    tag_names, suppressing_tag_names, suppresses_needs_first_response_by_tag,
    is_disqualified, disqualification_reason,
    needs_first_response, needs_first_response_reason
  )
  SELECT
    _property_id, r.contact_id, r.opportunity_id, r.assigned_user_id,
    r.pipeline_id, r.stage_id, r.canonical_stage, r.lead_created_at,
    r.first_any, r.first_human_out, r.first_auto, r.first_ai,
    r.first_human_channel,
    r.first_human_out, r.first_answered_in, r.first_engagement,
    CASE
      WHEN r.first_engagement IS NULL THEN NULL
      WHEN r.first_human_out IS NOT NULL AND (r.first_answered_in IS NULL OR r.first_human_out <= r.first_answered_in)
        THEN COALESCE('outbound_' || r.first_human_channel, 'outbound')
      ELSE 'answered_inbound_call'
    END,
    r.max_duration,
    CASE WHEN r.first_human_out IS NOT NULL
      THEN GREATEST(0, EXTRACT(EPOCH FROM (r.first_human_out - r.lead_created_at))::int)
      ELSE NULL END,
    COALESCE(r.human_attempts, 0),
    COALESCE(r.auto_touches,   0),
    COALESCE(r.ai_touches,     0),
    COALESCE(r.total_touches,  0),
    r.booked_at, r.showed_at, r.no_show_at,
    r.won_at, r.lost_at, r.lost_reason_raw, r.lost_reason_normalized, r.monetary_value,
    CASE WHEN r.opp_status IN ('won','lost','abandoned') THEN false ELSE true END,
    r.last_human_act,
    r.last_meaningful_activity_at,
    r.last_meaningful_activity_at,
    r.last_meaningful_activity_type,
    r.contact_record_updated_at,
    r.last_synced_at,
    r.handled_by_stage,
    COALESCE(r.tag_names, ARRAY[]::text[]),
    COALESCE(r.suppressing, ARRAY[]::text[]),
    COALESCE(r.has_supp_tag, false),
    COALESCE(r.has_supp_tag, false),
    CASE WHEN COALESCE(r.has_supp_tag, false)
      THEN 'Tag: ' || array_to_string(r.suppressing, ', ')
      ELSE NULL END,
    (CASE WHEN r.opp_status IN ('won','lost','abandoned') THEN false ELSE true END)
      AND r.first_engagement IS NULL
      AND NOT r.handled_by_stage
      AND NOT COALESCE(r.has_supp_tag, false),
    CASE
      WHEN r.contact_id IS NULL OR length(r.contact_id) = 0 THEN 'Missing contact link'
      WHEN r.opp_status IN ('won','lost','abandoned') THEN 'Excluded by status: ' || r.opp_status
      WHEN COALESCE(r.has_supp_tag, false) THEN 'Excluded by tag: ' || array_to_string(r.suppressing, ', ')
      WHEN r.handled_by_stage THEN 'Excluded by handled stage'
      WHEN r.first_answered_in IS NOT NULL THEN 'Excluded by answered inbound call ≥ 30s'
      WHEN r.first_human_out IS NOT NULL THEN 'Excluded by outbound human response'
      WHEN COALESCE(r.inbound_call_count, 0) > 0 AND COALESCE(r.max_seen_duration, 0) < _min_answered_call_seconds THEN 'Call exists but under 30 seconds'
      WHEN COALESCE(r.inbound_call_count, 0) > 0 AND NOT COALESCE(r.has_call_after_lead_created, false) THEN 'Call exists but before lead created timestamp'
      WHEN r.stage_id IS NOT NULL AND r.canonical_stage IS NULL THEN 'Stage is unconfirmed/unhandled'
      WHEN r.assigned_user_id IS NULL THEN 'No assigned agent · no outbound human response · no answered inbound call'
      ELSE 'No outbound human response · no answered inbound call'
    END
  FROM resolved r;

  GET DIAGNOSTICS _written = ROW_COUNT;

  WITH eng AS (
    SELECT contact_id, first_human_response_at AS first_human, last_human_activity_at AS last_human
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

CREATE OR REPLACE FUNCTION public.lead_perf_speed(_property_ids uuid[], _from timestamp with time zone, _to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _active_window int;
  _result jsonb;
BEGIN
  PERFORM public.lead_perf_check_access(_property_ids);

  SELECT COALESCE(MIN(COALESCE(pss.active_window_days, asd.active_window_days)), 30)
    INTO _active_window
  FROM public.agency_sla_defaults asd
  LEFT JOIN public.property_sla_settings pss
    ON _property_ids IS NOT NULL AND pss.property_id = ANY(_property_ids);

  WITH facts AS (
    SELECT *,
      EXTRACT(EPOCH FROM (first_human_outbound_at - lead_created_at)) AS outbound_response_seconds,
      EXTRACT(EPOCH FROM (first_human_engagement_at - lead_created_at)) AS engagement_seconds
    FROM public.ghl_lead_facts lf
    WHERE lf.lead_created_at >= _from AND lf.lead_created_at <= _to
      AND (_property_ids IS NULL OR lf.property_id = ANY(_property_ids))
  ),
  speed AS (
    SELECT
      COUNT(*) AS total_leads,
      COUNT(*) FILTER (WHERE first_human_outbound_at IS NOT NULL) AS responded,
      COUNT(*) FILTER (WHERE first_human_outbound_at IS NULL) AS never_responded,
      COUNT(*) FILTER (WHERE first_human_answered_inbound_at IS NOT NULL AND first_human_outbound_at IS NULL) AS answered_inbound_only,
      COUNT(*) FILTER (WHERE outbound_response_seconds <= 60)  AS under_1m,
      COUNT(*) FILTER (WHERE outbound_response_seconds <= 300) AS under_5m,
      COUNT(*) FILTER (WHERE outbound_response_seconds <= 900) AS under_15m,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY outbound_response_seconds)
        FILTER (WHERE outbound_response_seconds IS NOT NULL) AS median_human_raw,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY human_speed_to_lead_seconds_business)
        FILTER (WHERE human_speed_to_lead_seconds_business IS NOT NULL AND first_human_outbound_at IS NOT NULL) AS median_human_business,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY engagement_seconds)
        FILTER (WHERE engagement_seconds IS NOT NULL) AS median_human_engagement,
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (first_automation_response_at - lead_created_at))
      ) FILTER (WHERE first_automation_response_at IS NOT NULL) AS median_automation,
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (first_ai_response_at - lead_created_at))
      ) FILTER (WHERE first_ai_response_at IS NOT NULL) AS median_ai
    FROM facts
  ),
  waiting AS (
    SELECT COUNT(*) AS currently_waiting
    FROM public.ghl_lead_facts lf
    WHERE lf.is_open = true
      AND lf.first_human_outbound_at IS NULL
      AND lf.lead_created_at >= now() - make_interval(days => _active_window)
      AND (_property_ids IS NULL OR lf.property_id = ANY(_property_ids))
  )
  SELECT jsonb_build_object(
    'total_leads', s.total_leads,
    'responded', s.responded,
    'never_responded', s.never_responded,
    'answered_inbound_only', s.answered_inbound_only,
    'pct_never_responded', CASE WHEN s.total_leads > 0
      THEN ROUND(100.0 * s.never_responded / s.total_leads, 2) ELSE 0 END,
    'pct_under_1m', CASE WHEN s.total_leads > 0
      THEN ROUND(100.0 * s.under_1m / s.total_leads, 2) ELSE 0 END,
    'pct_under_5m', CASE WHEN s.total_leads > 0
      THEN ROUND(100.0 * s.under_5m / s.total_leads, 2) ELSE 0 END,
    'pct_under_15m', CASE WHEN s.total_leads > 0
      THEN ROUND(100.0 * s.under_15m / s.total_leads, 2) ELSE 0 END,
    'median_human_raw_seconds', s.median_human_raw,
    'median_human_business_seconds', s.median_human_business,
    'median_human_engagement_seconds', s.median_human_engagement,
    'median_automation_seconds', s.median_automation,
    'median_ai_seconds', s.median_ai,
    'human_vs_automation_gap_seconds',
      CASE WHEN s.median_human_raw IS NOT NULL AND s.median_automation IS NOT NULL
        THEN s.median_human_raw - s.median_automation ELSE NULL END,
    'currently_waiting', w.currently_waiting,
    'active_window_days', _active_window,
    'metric_definition', 'human response = first outbound human follow-up; answered inbound calls are counted separately and are not speed-to-lead responses'
  ) INTO _result
  FROM speed s, waiting w;

  RETURN _result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lead_perf_handling(_property_ids uuid[], _from timestamp with time zone, _to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _stale_hours int;
  _critical_hours int;
  _result jsonb;
BEGIN
  PERFORM public.lead_perf_check_access(_property_ids);

  SELECT
    COALESCE(MIN(COALESCE(pss.stale_after_hours, asd.stale_after_hours)), 24),
    COALESCE(MIN(COALESCE(pss.critical_stale_after_hours, asd.critical_stale_after_hours)), 48)
  INTO _stale_hours, _critical_hours
  FROM public.agency_sla_defaults asd
  LEFT JOIN public.property_sla_settings pss
    ON _property_ids IS NOT NULL AND pss.property_id = ANY(_property_ids);

  WITH facts AS (
    SELECT * FROM public.ghl_lead_facts lf
    WHERE lf.lead_created_at >= _from AND lf.lead_created_at <= _to
      AND (_property_ids IS NULL OR lf.property_id = ANY(_property_ids))
  )
  SELECT jsonb_build_object(
    'new', COUNT(*),
    'assigned', COUNT(*) FILTER (WHERE assigned_user_id IS NOT NULL),
    'contacted', COUNT(*) FILTER (WHERE first_human_outbound_at IS NOT NULL),
    'engaged', COUNT(*) FILTER (WHERE canonical_stage IN ('engaged','appointment','showed','won') OR first_human_engagement_at IS NOT NULL),
    'avg_human_attempts', ROUND(COALESCE(AVG(human_attempt_count), 0)::numeric, 2),
    'avg_automation_touches', ROUND(COALESCE(AVG(automation_touch_count), 0)::numeric, 2),
    'avg_ai_touches', ROUND(COALESCE(AVG(ai_touch_count), 0)::numeric, 2),
    'avg_total_touches', ROUND(COALESCE(AVG(total_touch_count), 0)::numeric, 2),
    'leads_zero_human_attempts',  COUNT(*) FILTER (WHERE human_attempt_count = 0),
    'leads_one_human_attempt',    COUNT(*) FILTER (WHERE human_attempt_count = 1),
    'leads_three_plus_attempts',  COUNT(*) FILTER (WHERE human_attempt_count >= 3),
    'stale_count', COUNT(*) FILTER (
      WHERE is_open = true
        AND COALESCE(last_human_activity_at, lead_created_at) < now() - make_interval(hours => _stale_hours)
    ),
    'critical_stale_count', COUNT(*) FILTER (
      WHERE is_open = true
        AND COALESCE(last_human_activity_at, lead_created_at) < now() - make_interval(hours => _critical_hours)
    ),
    'stale_after_hours', _stale_hours,
    'critical_stale_after_hours', _critical_hours
  ) INTO _result
  FROM facts;

  RETURN _result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lead_perf_pipeline(_property_ids uuid[], _from timestamp with time zone, _to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _needs_mapping boolean;
  _result jsonb;
BEGIN
  PERFORM public.lead_perf_check_access(_property_ids);

  SELECT EXISTS (
    SELECT 1
    FROM public.ghl_pipeline_stages s
    WHERE (_property_ids IS NULL OR s.property_id = ANY(_property_ids))
      AND NOT EXISTS (
        SELECT 1 FROM public.property_pipeline_mapping m
        WHERE m.property_id = s.property_id
          AND m.ghl_stage_id = s.ghl_stage_id
          AND m.confirmed_by_user = true
      )
  ) INTO _needs_mapping;

  WITH facts AS (
    SELECT * FROM public.ghl_lead_facts lf
    WHERE lf.lead_created_at >= _from AND lf.lead_created_at <= _to
      AND (_property_ids IS NULL OR lf.property_id = ANY(_property_ids))
  ),
  counts AS (
    SELECT
      COUNT(*) AS new_count,
      COUNT(*) FILTER (WHERE first_human_outbound_at IS NOT NULL OR canonical_stage IN ('contacted','engaged','appointment','showed','won','lost')) AS contacted,
      COUNT(*) FILTER (WHERE canonical_stage IN ('engaged','appointment','showed','won') OR first_human_engagement_at IS NOT NULL) AS engaged,
      COUNT(*) FILTER (WHERE appointment_booked_at IS NOT NULL OR canonical_stage IN ('appointment','showed','won')) AS appointments,
      COUNT(*) FILTER (WHERE appointment_showed_at IS NOT NULL OR canonical_stage IN ('showed','won')) AS showed,
      COUNT(*) FILTER (WHERE won_at IS NOT NULL OR canonical_stage = 'won') AS won,
      COUNT(*) FILTER (WHERE lost_at IS NOT NULL OR canonical_stage = 'lost') AS lost
    FROM facts
  )
  SELECT jsonb_build_object(
    'needs_mapping', _needs_mapping,
    'stages', jsonb_build_object(
      'new', c.new_count,
      'contacted', c.contacted,
      'engaged', c.engaged,
      'appointment', c.appointments,
      'showed', c.showed,
      'won', c.won,
      'lost', c.lost
    ),
    'transitions', jsonb_build_object(
      'new_to_contacted',         CASE WHEN c.new_count    > 0 THEN ROUND(100.0 * c.contacted    / c.new_count, 2)    ELSE 0 END,
      'contacted_to_engaged',     CASE WHEN c.contacted    > 0 THEN ROUND(100.0 * c.engaged      / c.contacted, 2)    ELSE 0 END,
      'engaged_to_appointment',   CASE WHEN c.engaged      > 0 THEN ROUND(100.0 * c.appointments / c.engaged, 2)      ELSE 0 END,
      'appointment_to_showed',    CASE WHEN c.appointments > 0 THEN ROUND(100.0 * c.showed       / c.appointments, 2) ELSE 0 END,
      'showed_to_won',            CASE WHEN c.showed       > 0 THEN ROUND(100.0 * c.won          / c.showed, 2)       ELSE 0 END,
      'lead_to_appointment',      CASE WHEN c.new_count    > 0 THEN ROUND(100.0 * c.appointments / c.new_count, 2)    ELSE 0 END,
      'lead_to_won',              CASE WHEN c.new_count    > 0 THEN ROUND(100.0 * c.won          / c.new_count, 2)    ELSE 0 END
    )
  ) INTO _result
  FROM counts c;

  RETURN _result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lead_perf_agents(_property_ids uuid[], _from timestamp with time zone, _to timestamp with time zone)
 RETURNS TABLE(ghl_user_id text, agent_name text, property_count integer, assigned integer, contacted integer, contact_rate numeric, booked integer, booking_rate numeric, showed integer, show_rate numeric, won integer, win_rate numeric, median_human_raw_seconds numeric, median_human_business_seconds numeric, avg_human_attempts numeric, stale_count integer, critical_stale_count integer, low_sample boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _stale int;
  _critical int;
BEGIN
  PERFORM public.lead_perf_check_access(_property_ids);

  SELECT
    COALESCE(MIN(COALESCE(pss.stale_after_hours, asd.stale_after_hours)), 24),
    COALESCE(MIN(COALESCE(pss.critical_stale_after_hours, asd.critical_stale_after_hours)), 48)
  INTO _stale, _critical
  FROM public.agency_sla_defaults asd
  LEFT JOIN public.property_sla_settings pss
    ON _property_ids IS NOT NULL AND pss.property_id = ANY(_property_ids);

  RETURN QUERY
  WITH facts AS (
    SELECT lf.*,
      EXTRACT(EPOCH FROM (lf.first_human_outbound_at - lf.lead_created_at)) AS outbound_response_seconds
    FROM public.ghl_lead_facts lf
    WHERE lf.lead_created_at >= _from AND lf.lead_created_at <= _to
      AND lf.assigned_user_id IS NOT NULL
      AND (_property_ids IS NULL OR lf.property_id = ANY(_property_ids))
  ),
  agg AS (
    SELECT
      f.assigned_user_id,
      COUNT(DISTINCT f.property_id)::int AS property_count,
      COUNT(*)::int AS assigned,
      COUNT(*) FILTER (WHERE f.first_human_outbound_at IS NOT NULL)::int AS contacted,
      COUNT(*) FILTER (WHERE f.appointment_booked_at IS NOT NULL
        OR f.canonical_stage IN ('appointment','showed','won'))::int AS booked,
      COUNT(*) FILTER (WHERE f.appointment_showed_at IS NOT NULL
        OR f.canonical_stage IN ('showed','won'))::int AS showed,
      COUNT(*) FILTER (WHERE f.won_at IS NOT NULL OR f.canonical_stage = 'won')::int AS won,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY f.outbound_response_seconds)
        FILTER (WHERE f.outbound_response_seconds IS NOT NULL) AS median_raw,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY f.human_speed_to_lead_seconds_business)
        FILTER (WHERE f.human_speed_to_lead_seconds_business IS NOT NULL AND f.first_human_outbound_at IS NOT NULL) AS median_business,
      AVG(f.human_attempt_count)::numeric AS avg_attempts,
      COUNT(*) FILTER (WHERE f.is_open = true
        AND COALESCE(f.last_human_activity_at, f.lead_created_at) < now() - make_interval(hours => _stale))::int AS stale_count,
      COUNT(*) FILTER (WHERE f.is_open = true
        AND COALESCE(f.last_human_activity_at, f.lead_created_at) < now() - make_interval(hours => _critical))::int AS critical_stale_count
    FROM facts f
    GROUP BY f.assigned_user_id
  )
  SELECT
    a.assigned_user_id,
    COALESCE(MAX(u.name), a.assigned_user_id) AS agent_name,
    a.property_count,
    a.assigned,
    a.contacted,
    CASE WHEN a.assigned > 0    THEN ROUND(100.0 * a.contacted / a.assigned, 2) ELSE 0 END AS contact_rate,
    a.booked,
    CASE WHEN a.assigned > 0    THEN ROUND(100.0 * a.booked    / a.assigned, 2) ELSE 0 END AS booking_rate,
    a.showed,
    CASE WHEN a.booked > 0      THEN ROUND(100.0 * a.showed    / a.booked,   2) ELSE 0 END AS show_rate,
    a.won,
    CASE WHEN a.assigned > 0    THEN ROUND(100.0 * a.won       / a.assigned, 2) ELSE 0 END AS win_rate,
    a.median_raw::numeric,
    a.median_business::numeric,
    ROUND(COALESCE(a.avg_attempts, 0), 2),
    a.stale_count,
    a.critical_stale_count,
    (a.assigned < 5) AS low_sample
  FROM agg a
  LEFT JOIN public.ghl_users u ON u.ghl_user_id = a.assigned_user_id
    AND (_property_ids IS NULL OR u.property_id = ANY(_property_ids))
  GROUP BY a.assigned_user_id, a.property_count, a.assigned, a.contacted, a.booked,
           a.showed, a.won, a.median_raw, a.median_business, a.avg_attempts,
           a.stale_count, a.critical_stale_count
  ORDER BY a.assigned DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lead_perf_drill(_issue_type text, _property_ids uuid[], _from timestamp with time zone, _to timestamp with time zone, _limit integer DEFAULT 500)
 RETURNS TABLE(property_id uuid, property_name text, contact_id text, contact_name text, phone text, email text, assigned_user_id text, agent_name text, agent_is_default boolean, lead_created_at timestamp with time zone, stage_id text, stage_name text, canonical_stage ghl_canonical_stage, last_activity_at timestamp with time zone, last_activity_type text, first_human_response_at timestamp with time zone, speed_to_lead_seconds integer, human_attempt_count integer, issue_type text, ghl_deep_link text, reason text, tag_names text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _stale int; _critical int; _active_window int; _slow_threshold int;
BEGIN
  PERFORM public.lead_perf_check_access(_property_ids);

  SELECT
    COALESCE(MIN(COALESCE(pss.stale_after_hours, asd.stale_after_hours)), 24),
    COALESCE(MIN(COALESCE(pss.critical_stale_after_hours, asd.critical_stale_after_hours)), 48),
    COALESCE(MIN(COALESCE(pss.active_window_days, asd.active_window_days)), 30),
    COALESCE(MIN(COALESCE(pss.first_response_seconds, asd.first_response_seconds)), 300)
  INTO _stale, _critical, _active_window, _slow_threshold
  FROM public.agency_sla_defaults asd
  LEFT JOIN public.property_sla_settings pss
    ON _property_ids IS NOT NULL AND pss.property_id = ANY(_property_ids);

  RETURN QUERY
  WITH base AS (
    SELECT
      lf.*,
      EXTRACT(EPOCH FROM (lf.first_human_outbound_at - lf.lead_created_at))::int AS outbound_response_seconds,
      p.name AS p_name,
      p.default_lead_owner_user_id AS default_owner_id,
      c.first_name, c.last_name, c.phone AS c_phone, c.email AS c_email,
      s.name AS s_name,
      u.name AS u_name,
      du.name AS default_owner_name,
      pds.config->>'location_id' AS loc_id
    FROM public.ghl_lead_facts lf
    JOIN public.properties p ON p.id = lf.property_id
    LEFT JOIN public.ghl_contacts c
      ON c.property_id = lf.property_id AND c.ghl_contact_id = lf.contact_id
    LEFT JOIN public.ghl_pipeline_stages s
      ON s.property_id = lf.property_id AND s.ghl_stage_id = lf.stage_id
    LEFT JOIN public.ghl_users u
      ON u.property_id = lf.property_id AND u.ghl_user_id = lf.assigned_user_id
    LEFT JOIN public.ghl_users du
      ON du.property_id = lf.property_id AND du.ghl_user_id = p.default_lead_owner_user_id
    LEFT JOIN public.property_data_sources pds
      ON pds.property_id = lf.property_id AND pds.source = 'ghl'
    WHERE (_property_ids IS NULL OR lf.property_id = ANY(_property_ids))
      AND (
        _issue_type IN ('currently_waiting','stale','critical_stale','disqualified_by_tag')
        OR (lf.lead_created_at >= _from AND lf.lead_created_at <= _to)
      )
  ),
  filtered AS (
    SELECT b.*, _issue_type AS itype,
      (CASE _issue_type
        WHEN 'never_responded' THEN
          CASE
            WHEN b.assigned_user_id IS NULL AND b.default_owner_id IS NULL THEN
              'No outbound human response · unassigned'
            ELSE
              'No outbound human response'
          END
        WHEN 'currently_waiting' THEN 'Open lead with no outbound human response yet'
        WHEN 'stale' THEN 'No human activity for ' || _stale || 'h+'
        WHEN 'critical_stale' THEN 'No human activity for ' || _critical || 'h+'
        WHEN 'unassigned' THEN 'No agent assigned · no property default owner'
        WHEN 'missing_opportunity' THEN 'Contact has no opportunity record'
        WHEN 'lost_without_reason' THEN 'Marked lost without a reason'
        WHEN 'slow_response' THEN 'Outbound human response after ' || _slow_threshold || 's threshold'
        WHEN 'disqualified_by_tag' THEN COALESCE('Excluded by tag: ' || array_to_string(b.suppressing_tag_names, ', '), 'Disqualified by tag')
        ELSE NULL END) AS reason_text
    FROM base b
    WHERE
      (_issue_type = 'never_responded' AND b.first_human_outbound_at IS NULL AND b.lead_created_at >= _from AND b.lead_created_at <= _to)
   OR (_issue_type = 'currently_waiting'
        AND b.is_open = true
        AND b.first_human_outbound_at IS NULL
        AND NOT b.handled_by_stage
        AND NOT b.suppresses_needs_first_response_by_tag
        AND b.lead_created_at >= now() - make_interval(days => _active_window))
   OR (_issue_type = 'stale'
        AND b.is_open = true
        AND COALESCE(b.last_human_activity_at, b.lead_created_at) < now() - make_interval(hours => _stale))
   OR (_issue_type = 'critical_stale'
        AND b.is_open = true
        AND COALESCE(b.last_human_activity_at, b.lead_created_at) < now() - make_interval(hours => _critical))
   OR (_issue_type = 'unassigned'
        AND b.assigned_user_id IS NULL
        AND b.default_owner_id IS NULL)
   OR (_issue_type = 'missing_opportunity'
        AND b.opportunity_id IS NULL)
   OR (_issue_type = 'lost_without_reason'
        AND b.lost_at IS NOT NULL
        AND (b.lost_reason_raw IS NULL OR length(trim(b.lost_reason_raw)) = 0))
   OR (_issue_type = 'slow_response'
        AND b.outbound_response_seconds IS NOT NULL
        AND b.outbound_response_seconds > _slow_threshold)
   OR (_issue_type = 'disqualified_by_tag'
        AND b.is_disqualified = true)
  )
  SELECT
    f.property_id, f.p_name, f.contact_id,
    NULLIF(trim(COALESCE(f.first_name,'') || ' ' || COALESCE(f.last_name,'')), ''),
    f.c_phone, f.c_email,
    f.assigned_user_id,
    COALESCE(f.u_name, f.default_owner_name) AS agent_name,
    (f.assigned_user_id IS NULL AND f.default_owner_id IS NOT NULL) AS agent_is_default,
    f.lead_created_at,
    f.stage_id, f.s_name, f.canonical_stage,
    COALESCE(f.last_meaningful_activity_at, f.lead_created_at) AS last_activity_at,
    COALESCE(f.last_meaningful_activity_type, 'lead created') AS last_activity_type,
    f.first_human_outbound_at,
    f.outbound_response_seconds, f.human_attempt_count,
    f.itype,
    CASE WHEN f.loc_id IS NOT NULL AND f.contact_id IS NOT NULL
      THEN 'https://app.gohighlevel.com/v2/location/' || f.loc_id || '/contacts/detail/' || f.contact_id
      ELSE NULL END,
    f.reason_text,
    COALESCE(f.tag_names, ARRAY[]::text[])
  FROM filtered f
  WHERE _issue_type IN (
    'never_responded','currently_waiting','stale','critical_stale','unassigned',
    'missing_opportunity','lost_without_reason','slow_response','disqualified_by_tag'
  )
  ORDER BY f.lead_created_at DESC NULLS LAST
  LIMIT _limit;

  IF _issue_type = 'duplicate_contacts' THEN
    RETURN QUERY
    SELECT
      c.property_id, p.name, c.ghl_contact_id,
      NULLIF(trim(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')), ''),
      c.phone, c.email, c.assigned_user_id,
      COALESCE(u.name, du.name), (c.assigned_user_id IS NULL AND p.default_lead_owner_user_id IS NOT NULL),
      NULL::timestamptz, NULL::text, NULL::text, NULL::public.ghl_canonical_stage,
      c.ghl_created_at, 'lead created'::text, c.first_human_response_at,
      NULL::int, NULL::int,
      'duplicate_contacts'::text,
      CASE WHEN pds.config->>'location_id' IS NOT NULL
        THEN 'https://app.gohighlevel.com/v2/location/' || (pds.config->>'location_id') || '/contacts/detail/' || c.ghl_contact_id
        ELSE NULL END,
      'Same phone or email as another contact'::text,
      COALESCE(c.tags, ARRAY[]::text[])
    FROM public.ghl_contacts c
    JOIN public.properties p ON p.id = c.property_id
    LEFT JOIN public.ghl_users u ON u.property_id = c.property_id AND u.ghl_user_id = c.assigned_user_id
    LEFT JOIN public.ghl_users du ON du.property_id = c.property_id AND du.ghl_user_id = p.default_lead_owner_user_id
    LEFT JOIN public.property_data_sources pds ON pds.property_id = c.property_id AND pds.source = 'ghl'
    WHERE c.duplicate_group_id IS NOT NULL
      AND (_property_ids IS NULL OR c.property_id = ANY(_property_ids))
      AND c.duplicate_group_id IN (
        SELECT duplicate_group_id FROM public.ghl_contacts
        WHERE duplicate_group_id IS NOT NULL
          AND (_property_ids IS NULL OR property_id = ANY(_property_ids))
        GROUP BY property_id, duplicate_group_id HAVING COUNT(*) > 1
      )
    ORDER BY c.duplicate_group_id
    LIMIT _limit;
  END IF;

  IF _issue_type = 'duplicate_opportunities' THEN
    RETURN QUERY
    WITH dups AS (
      SELECT o.property_id, o.contact_id
      FROM public.ghl_opportunities o
      WHERE o.contact_id IS NOT NULL
        AND (_property_ids IS NULL OR o.property_id = ANY(_property_ids))
        AND o.ghl_created_at >= _from AND o.ghl_created_at <= _to
      GROUP BY o.property_id, o.contact_id HAVING COUNT(*) > 1
    )
    SELECT
      o.property_id, p.name, o.contact_id,
      NULLIF(trim(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')), ''),
      c.phone, c.email, o.assigned_to,
      COALESCE(u.name, du.name), (o.assigned_to IS NULL AND p.default_lead_owner_user_id IS NOT NULL),
      o.ghl_created_at, o.stage_id, s.name, NULL::public.ghl_canonical_stage,
      o.ghl_created_at, 'opportunity created'::text, NULL::timestamptz,
      NULL::int, NULL::int,
      'duplicate_opportunities'::text,
      CASE WHEN pds.config->>'location_id' IS NOT NULL
        THEN 'https://app.gohighlevel.com/v2/location/' || (pds.config->>'location_id') || '/contacts/detail/' || o.contact_id
        ELSE NULL END,
      'Multiple opportunities for the same contact'::text,
      COALESCE(c.tags, ARRAY[]::text[])
    FROM public.ghl_opportunities o
    JOIN dups d ON d.property_id = o.property_id AND d.contact_id = o.contact_id
    JOIN public.properties p ON p.id = o.property_id
    LEFT JOIN public.ghl_contacts c ON c.property_id = o.property_id AND c.ghl_contact_id = o.contact_id
    LEFT JOIN public.ghl_users u ON u.property_id = o.property_id AND u.ghl_user_id = o.assigned_to
    LEFT JOIN public.ghl_users du ON du.property_id = o.property_id AND du.ghl_user_id = p.default_lead_owner_user_id
    LEFT JOIN public.ghl_pipeline_stages s ON s.property_id = o.property_id AND s.ghl_stage_id = o.stage_id
    LEFT JOIN public.property_data_sources pds ON pds.property_id = o.property_id AND pds.source = 'ghl'
    ORDER BY o.contact_id, o.ghl_created_at
    LIMIT _limit;
  END IF;
END;
$function$;

SELECT public.rebuild_lead_facts(p.id)
FROM public.properties p
WHERE EXISTS (
  SELECT 1 FROM public.ghl_contacts c WHERE c.property_id = p.id
);