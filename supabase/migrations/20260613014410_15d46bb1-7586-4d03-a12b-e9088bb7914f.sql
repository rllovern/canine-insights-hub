
-- 1. Add columns to ghl_lead_facts
ALTER TABLE public.ghl_lead_facts
  ADD COLUMN IF NOT EXISTS first_human_outbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_human_answered_inbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_human_engagement_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_human_engagement_type text,
  ADD COLUMN IF NOT EXISTS human_call_duration_seconds integer,
  ADD COLUMN IF NOT EXISTS needs_first_response boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS handled_by_stage boolean NOT NULL DEFAULT false;

-- 2. Add per-stage flags to property_pipeline_mapping
ALTER TABLE public.property_pipeline_mapping
  ADD COLUMN IF NOT EXISTS counts_as_human_handled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suppresses_needs_first_response boolean NOT NULL DEFAULT false;

-- Default handled flags for already-mapped canonical stages
UPDATE public.property_pipeline_mapping
SET counts_as_human_handled = true,
    suppresses_needs_first_response = true
WHERE canonical_stage IN ('contacted','engaged','appointment','showed','won')
  AND counts_as_human_handled = false;

-- 3. Updated suggestion seeder: detect form/application/quote-style intermediate stages
CREATE OR REPLACE FUNCTION public.seed_pipeline_mapping_suggestions(_property_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _r int := 0;
BEGIN
  INSERT INTO public.property_pipeline_mapping
    (property_id, ghl_stage_id, ghl_pipeline_id, canonical_stage, suggested_canonical_stage,
     confirmed_by_user, counts_as_human_handled, suppresses_needs_first_response)
  SELECT
    s.property_id,
    s.ghl_stage_id,
    s.ghl_pipeline_id,
    cs.stage,
    cs.stage,
    false,
    cs.handled,
    cs.handled
  FROM public.ghl_pipeline_stages s
  CROSS JOIN LATERAL (
    SELECT
      (CASE
        WHEN s.name ~* '(won|sold|paid|admit|enrolled|closed.?won)'                 THEN 'won'
        WHEN s.name ~* '(lost|bad.?fit|disqualif|closed.?lost|dead)'                THEN 'lost'
        WHEN s.name ~* '(no.?show)'                                                 THEN 'lost'
        WHEN s.name ~* '(show|attend)'                                              THEN 'showed'
        WHEN s.name ~* '(book|schedul|appoint)'                                     THEN 'appointment'
        WHEN s.name ~* '(form|applic|quote|estimate|intake|sale.?process|proposal|contract|onboard)' THEN 'engaged'
        WHEN s.name ~* '(replied|engaged|qualif|warm|nurtur)'                       THEN 'engaged'
        WHEN s.name ~* '(contact|call|text|reach|attempt)'                          THEN 'contacted'
        WHEN s.name ~* '(new|fresh|lead|inbox|inquir)'                              THEN 'new'
        ELSE 'ignore'
      END)::public.ghl_canonical_stage AS stage,
      (CASE
        WHEN s.name ~* '(won|sold|paid|admit|enrolled|closed.?won)'                 THEN true
        WHEN s.name ~* '(lost|bad.?fit|disqualif|closed.?lost|dead)'                THEN true
        WHEN s.name ~* '(no.?show)'                                                 THEN true
        WHEN s.name ~* '(show|attend)'                                              THEN true
        WHEN s.name ~* '(book|schedul|appoint)'                                     THEN true
        WHEN s.name ~* '(form|applic|quote|estimate|intake|sale.?process|proposal|contract|onboard)' THEN true
        WHEN s.name ~* '(replied|engaged|qualif|warm|nurtur)'                       THEN true
        WHEN s.name ~* '(contact|call|text|reach|attempt)'                          THEN true
        ELSE false
      END) AS handled
  ) cs
  WHERE s.property_id = _property_id
  ON CONFLICT (property_id, ghl_stage_id) DO NOTHING;
  GET DIAGNOSTICS _r = ROW_COUNT;
  RETURN _r;
END $function$;

-- 4. Rebuilt rebuild_lead_facts with answered-inbound + handled-by-stage logic
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
  -- Outbound aggregates (unchanged definition of "outbound human")
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
  -- Answered inbound calls: TYPE_CALL, status='completed', duration >= threshold
  in_call_agg AS (
    SELECT
      m.contact_id,
      MIN(m.sent_at) AS first_answered_in,
      MAX(m.sent_at) AS last_answered_in,
      MAX((m.meta->'call'->>'duration')::int) AS max_duration
    FROM public.ghl_messages m
    WHERE m.property_id = _property_id
      AND m.contact_id IS NOT NULL
      AND m.message_type = 'TYPE_CALL'
      AND m.direction = 'inbound'
      AND lower(COALESCE(m.meta->'call'->>'status','')) IN ('completed','answered','in-progress')
      AND COALESCE(NULLIF(m.meta->'call'->>'duration','')::int, 0) >= _min_answered_call_seconds
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
      LEAST(oa.first_human_out, ica.first_answered_in) AS first_engagement,
      GREATEST(oa.last_human_out_activity, ica.last_answered_in) AS last_human_act,
      aa.booked_at, aa.showed_at, aa.no_show_at
    FROM base b
    LEFT JOIN out_agg    oa  ON oa.contact_id  = b.contact_id
    LEFT JOIN in_call_agg ica ON ica.contact_id = b.contact_id
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
    handled_by_stage, needs_first_response
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
    GREATEST(r.last_human_act, r.last_answered_in),
    r.last_activity,
    r.handled_by_stage,
    -- needs_first_response: open, no human engagement, not handled by stage
    (CASE WHEN r.opp_status IN ('won','lost','abandoned') THEN false ELSE true END)
      AND r.first_engagement IS NULL
      AND NOT r.handled_by_stage
  FROM resolved r;

  GET DIAGNOSTICS _written = ROW_COUNT;

  -- Refresh convenience cols on ghl_contacts (use engagement timestamp)
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
END $function$;

-- 5. lead_perf_drill: add `reason` column, use needs_first_response for never_responded
DROP FUNCTION IF EXISTS public.lead_perf_drill(text, uuid[], timestamptz, timestamptz, integer);

CREATE OR REPLACE FUNCTION public.lead_perf_drill(
  _issue_type text,
  _property_ids uuid[],
  _from timestamptz,
  _to timestamptz,
  _limit integer DEFAULT 500
)
RETURNS TABLE(
  property_id uuid, property_name text,
  contact_id text, contact_name text, phone text, email text,
  assigned_user_id text, agent_name text,
  lead_created_at timestamptz,
  stage_id text, stage_name text, canonical_stage ghl_canonical_stage,
  last_activity_at timestamptz, first_human_response_at timestamptz,
  speed_to_lead_seconds integer, human_attempt_count integer,
  issue_type text, ghl_deep_link text, reason text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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
      p.name AS p_name,
      c.first_name, c.last_name, c.phone AS c_phone, c.email AS c_email,
      s.name AS s_name,
      u.name AS u_name,
      pds.config->>'location_id' AS loc_id
    FROM public.ghl_lead_facts lf
    JOIN public.properties p ON p.id = lf.property_id
    LEFT JOIN public.ghl_contacts c
      ON c.property_id = lf.property_id AND c.ghl_contact_id = lf.contact_id
    LEFT JOIN public.ghl_pipeline_stages s
      ON s.property_id = lf.property_id AND s.ghl_stage_id = lf.stage_id
    LEFT JOIN public.ghl_users u
      ON u.property_id = lf.property_id AND u.ghl_user_id = lf.assigned_user_id
    LEFT JOIN public.property_data_sources pds
      ON pds.property_id = lf.property_id AND pds.source = 'ghl'
    WHERE (_property_ids IS NULL OR lf.property_id = ANY(_property_ids))
      AND (
        _issue_type IN ('currently_waiting','stale','critical_stale')
        OR (lf.lead_created_at >= _from AND lf.lead_created_at <= _to)
      )
  ),
  filtered AS (
    SELECT b.*, _issue_type AS itype,
      (CASE _issue_type
        WHEN 'never_responded' THEN
          CASE WHEN b.assigned_user_id IS NULL THEN 'No assigned agent · no human engagement'
               ELSE 'No outbound message and no answered inbound call' END
        WHEN 'currently_waiting' THEN 'Open lead with no human engagement yet'
        WHEN 'stale' THEN 'No human activity for ' || _stale || 'h+'
        WHEN 'critical_stale' THEN 'No human activity for ' || _critical || 'h+'
        WHEN 'unassigned' THEN 'No agent assigned'
        WHEN 'missing_opportunity' THEN 'Contact has no opportunity record'
        WHEN 'lost_without_reason' THEN 'Marked lost without a reason'
        WHEN 'slow_response' THEN 'Human responded after ' || _slow_threshold || 's threshold'
        ELSE NULL END) AS reason_text
    FROM base b
    WHERE
      (_issue_type = 'never_responded'
        AND b.needs_first_response = true)
   OR (_issue_type = 'currently_waiting'
        AND b.is_open = true
        AND b.first_human_engagement_at IS NULL
        AND NOT b.handled_by_stage
        AND b.lead_created_at >= now() - make_interval(days => _active_window))
   OR (_issue_type = 'stale'
        AND b.is_open = true
        AND COALESCE(b.last_human_activity_at, b.lead_created_at) < now() - make_interval(hours => _stale))
   OR (_issue_type = 'critical_stale'
        AND b.is_open = true
        AND COALESCE(b.last_human_activity_at, b.lead_created_at) < now() - make_interval(hours => _critical))
   OR (_issue_type = 'unassigned'
        AND b.assigned_user_id IS NULL)
   OR (_issue_type = 'missing_opportunity'
        AND b.opportunity_id IS NULL)
   OR (_issue_type = 'lost_without_reason'
        AND b.lost_at IS NOT NULL
        AND (b.lost_reason_raw IS NULL OR length(trim(b.lost_reason_raw)) = 0))
   OR (_issue_type = 'slow_response'
        AND b.human_speed_to_lead_seconds_raw IS NOT NULL
        AND b.human_speed_to_lead_seconds_raw > _slow_threshold)
  )
  SELECT
    f.property_id, f.p_name, f.contact_id,
    NULLIF(trim(COALESCE(f.first_name,'') || ' ' || COALESCE(f.last_name,'')), ''),
    f.c_phone, f.c_email,
    f.assigned_user_id, f.u_name,
    f.lead_created_at,
    f.stage_id, f.s_name, f.canonical_stage,
    f.last_activity_at, f.first_human_response_at,
    f.human_speed_to_lead_seconds_raw, f.human_attempt_count,
    f.itype,
    CASE WHEN f.loc_id IS NOT NULL AND f.contact_id IS NOT NULL
      THEN 'https://app.gohighlevel.com/v2/location/' || f.loc_id || '/contacts/detail/' || f.contact_id
      ELSE NULL END,
    f.reason_text
  FROM filtered f
  WHERE _issue_type IN (
    'never_responded','currently_waiting','stale','critical_stale','unassigned',
    'missing_opportunity','lost_without_reason','slow_response'
  )
  ORDER BY f.lead_created_at DESC
  LIMIT _limit;

  IF _issue_type = 'duplicate_contacts' THEN
    RETURN QUERY
    SELECT
      c.property_id, p.name, c.ghl_contact_id,
      NULLIF(trim(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')), ''),
      c.phone, c.email, c.assigned_user_id, u.name,
      NULL::timestamptz, NULL::text, NULL::text, NULL::public.ghl_canonical_stage,
      NULL::timestamptz, c.first_human_response_at,
      NULL::int, NULL::int,
      'duplicate_contacts'::text,
      CASE WHEN pds.config->>'location_id' IS NOT NULL
        THEN 'https://app.gohighlevel.com/v2/location/' || (pds.config->>'location_id') || '/contacts/detail/' || c.ghl_contact_id
        ELSE NULL END,
      'Same phone or email as another contact'::text
    FROM public.ghl_contacts c
    JOIN public.properties p ON p.id = c.property_id
    LEFT JOIN public.ghl_users u ON u.property_id = c.property_id AND u.ghl_user_id = c.assigned_user_id
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
      c.phone, c.email, o.assigned_to, u.name,
      o.ghl_created_at, o.stage_id, s.name, NULL::public.ghl_canonical_stage,
      o.ghl_updated_at, NULL::timestamptz,
      NULL::int, NULL::int,
      'duplicate_opportunities'::text,
      CASE WHEN pds.config->>'location_id' IS NOT NULL
        THEN 'https://app.gohighlevel.com/v2/location/' || (pds.config->>'location_id') || '/contacts/detail/' || o.contact_id
        ELSE NULL END,
      'Multiple opportunities for the same contact'::text
    FROM public.ghl_opportunities o
    JOIN dups d ON d.property_id = o.property_id AND d.contact_id = o.contact_id
    JOIN public.properties p ON p.id = o.property_id
    LEFT JOIN public.ghl_contacts c ON c.property_id = o.property_id AND c.ghl_contact_id = o.contact_id
    LEFT JOIN public.ghl_users u ON u.property_id = o.property_id AND u.ghl_user_id = o.assigned_to
    LEFT JOIN public.ghl_pipeline_stages s ON s.property_id = o.property_id AND s.ghl_stage_id = o.stage_id
    LEFT JOIN public.property_data_sources pds ON pds.property_id = o.property_id AND pds.source = 'ghl'
    ORDER BY o.ghl_created_at DESC NULLS LAST
    LIMIT _limit;
  END IF;

  IF _issue_type = 'unknown_response_source' THEN
    RETURN QUERY
    SELECT
      m.property_id, p.name, m.contact_id,
      NULLIF(trim(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')), ''),
      c.phone, c.email, c.assigned_user_id, u.name,
      NULL::timestamptz, NULL::text, NULL::text, NULL::public.ghl_canonical_stage,
      m.sent_at, NULL::timestamptz,
      NULL::int, NULL::int,
      'unknown_response_source'::text,
      CASE WHEN pds.config->>'location_id' IS NOT NULL AND m.contact_id IS NOT NULL
        THEN 'https://app.gohighlevel.com/v2/location/' || (pds.config->>'location_id') || '/contacts/detail/' || m.contact_id
        ELSE NULL END,
      'Outbound message could not be classified as human/automation/AI'::text
    FROM public.ghl_messages m
    JOIN public.properties p ON p.id = m.property_id
    LEFT JOIN public.ghl_contacts c ON c.property_id = m.property_id AND c.ghl_contact_id = m.contact_id
    LEFT JOIN public.ghl_users u ON u.property_id = m.property_id AND u.ghl_user_id = c.assigned_user_id
    LEFT JOIN public.property_data_sources pds ON pds.property_id = m.property_id AND pds.source = 'ghl'
    WHERE m.response_source = 'unknown'
      AND m.sent_at >= _from AND m.sent_at <= _to
      AND (_property_ids IS NULL OR m.property_id = ANY(_property_ids))
    ORDER BY m.sent_at DESC
    LIMIT _limit;
  END IF;

  IF _issue_type = 'appointments_missing_status' THEN
    RETURN QUERY
    SELECT
      a.property_id, p.name, a.contact_id,
      NULLIF(trim(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')), ''),
      c.phone, c.email, a.assigned_user_id, u.name,
      a.starts_at, NULL::text, NULL::text, NULL::public.ghl_canonical_stage,
      a.ends_at, NULL::timestamptz,
      NULL::int, NULL::int,
      'appointments_missing_status'::text,
      CASE WHEN pds.config->>'location_id' IS NOT NULL AND a.contact_id IS NOT NULL
        THEN 'https://app.gohighlevel.com/v2/location/' || (pds.config->>'location_id') || '/contacts/detail/' || a.contact_id
        ELSE NULL END,
      'Appointment has no showed / no-show status'::text
    FROM public.ghl_appointments a
    JOIN public.properties p ON p.id = a.property_id
    LEFT JOIN public.ghl_contacts c ON c.property_id = a.property_id AND c.ghl_contact_id = a.contact_id
    LEFT JOIN public.ghl_users u ON u.property_id = a.property_id AND u.ghl_user_id = a.assigned_user_id
    LEFT JOIN public.property_data_sources pds ON pds.property_id = a.property_id AND pds.source = 'ghl'
    WHERE a.appointment_status = 'unknown'
      AND a.starts_at >= _from AND a.starts_at <= _to
      AND (_property_ids IS NULL OR a.property_id = ANY(_property_ids))
    ORDER BY a.starts_at DESC
    LIMIT _limit;
  END IF;

  IF _issue_type = 'unmapped_stages' THEN
    RETURN QUERY
    SELECT
      s.property_id, p.name, NULL::text,
      s.name, NULL::text, NULL::text,
      NULL::text, NULL::text,
      NULL::timestamptz, s.ghl_stage_id, s.name, NULL::public.ghl_canonical_stage,
      NULL::timestamptz, NULL::timestamptz,
      NULL::int, NULL::int,
      'unmapped_stages'::text, NULL::text,
      'Pipeline stage has no confirmed mapping'::text
    FROM public.ghl_pipeline_stages s
    JOIN public.properties p ON p.id = s.property_id
    WHERE (_property_ids IS NULL OR s.property_id = ANY(_property_ids))
      AND NOT EXISTS (
        SELECT 1 FROM public.property_pipeline_mapping m
        WHERE m.property_id = s.property_id
          AND m.ghl_stage_id = s.ghl_stage_id
          AND m.confirmed_by_user = true
      )
    ORDER BY p.name, s.position NULLS LAST
    LIMIT _limit;
  END IF;
END $function$;
