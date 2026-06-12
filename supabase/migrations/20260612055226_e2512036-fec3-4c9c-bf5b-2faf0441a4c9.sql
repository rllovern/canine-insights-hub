
-- =====================================================================
-- Access check helper
-- =====================================================================
CREATE OR REPLACE FUNCTION public.lead_perf_check_access(_property_ids uuid[])
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _pid uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF public.has_role(_uid, 'internal'::app_role) THEN RETURN; END IF;
  IF _property_ids IS NULL THEN RAISE EXCEPTION 'agency scope requires internal role'; END IF;
  FOREACH _pid IN ARRAY _property_ids LOOP
    IF NOT public.viewer_can_access(_uid, _pid) THEN
      RAISE EXCEPTION 'access denied for property %', _pid;
    END IF;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION public.lead_perf_check_access(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_perf_check_access(uuid[]) TO authenticated, service_role;

-- =====================================================================
-- 1) lead_perf_speed
-- =====================================================================
CREATE OR REPLACE FUNCTION public.lead_perf_speed(
  _property_ids uuid[],
  _from timestamptz,
  _to timestamptz
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
    SELECT * FROM public.ghl_lead_facts lf
    WHERE lf.lead_created_at >= _from AND lf.lead_created_at <= _to
      AND (_property_ids IS NULL OR lf.property_id = ANY(_property_ids))
  ),
  speed AS (
    SELECT
      COUNT(*) AS total_leads,
      COUNT(*) FILTER (WHERE first_human_response_at IS NOT NULL) AS responded,
      COUNT(*) FILTER (WHERE first_human_response_at IS NULL) AS never_responded,
      COUNT(*) FILTER (WHERE human_speed_to_lead_seconds_raw <= 60)  AS under_1m,
      COUNT(*) FILTER (WHERE human_speed_to_lead_seconds_raw <= 300) AS under_5m,
      COUNT(*) FILTER (WHERE human_speed_to_lead_seconds_raw <= 900) AS under_15m,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY human_speed_to_lead_seconds_raw)
        FILTER (WHERE human_speed_to_lead_seconds_raw IS NOT NULL) AS median_human_raw,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY human_speed_to_lead_seconds_business)
        FILTER (WHERE human_speed_to_lead_seconds_business IS NOT NULL) AS median_human_business,
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
      AND lf.first_human_response_at IS NULL
      AND lf.lead_created_at >= now() - make_interval(days => _active_window)
      AND (_property_ids IS NULL OR lf.property_id = ANY(_property_ids))
  )
  SELECT jsonb_build_object(
    'total_leads', s.total_leads,
    'responded', s.responded,
    'never_responded', s.never_responded,
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
    'median_automation_seconds', s.median_automation,
    'median_ai_seconds', s.median_ai,
    'human_vs_automation_gap_seconds',
      CASE WHEN s.median_human_raw IS NOT NULL AND s.median_automation IS NOT NULL
        THEN s.median_human_raw - s.median_automation ELSE NULL END,
    'currently_waiting', w.currently_waiting,
    'active_window_days', _active_window
  ) INTO _result
  FROM speed s, waiting w;

  RETURN _result;
END $$;
REVOKE EXECUTE ON FUNCTION public.lead_perf_speed(uuid[], timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_perf_speed(uuid[], timestamptz, timestamptz) TO authenticated, service_role;

-- =====================================================================
-- 2) lead_perf_handling
-- =====================================================================
CREATE OR REPLACE FUNCTION public.lead_perf_handling(
  _property_ids uuid[],
  _from timestamptz,
  _to timestamptz
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
    'contacted', COUNT(*) FILTER (WHERE first_human_response_at IS NOT NULL),
    'engaged', COUNT(*) FILTER (WHERE canonical_stage IN ('engaged','appointment','showed','won')),
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
END $$;
REVOKE EXECUTE ON FUNCTION public.lead_perf_handling(uuid[], timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_perf_handling(uuid[], timestamptz, timestamptz) TO authenticated, service_role;

-- =====================================================================
-- 3) lead_perf_pipeline
-- =====================================================================
CREATE OR REPLACE FUNCTION public.lead_perf_pipeline(
  _property_ids uuid[],
  _from timestamptz,
  _to timestamptz
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _needs_mapping boolean;
  _result jsonb;
BEGIN
  PERFORM public.lead_perf_check_access(_property_ids);

  -- A property needs mapping when it has stages but no confirmed mapping rows.
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
      COUNT(*) FILTER (WHERE first_human_response_at IS NOT NULL OR canonical_stage IN ('contacted','engaged','appointment','showed','won','lost')) AS contacted,
      COUNT(*) FILTER (WHERE canonical_stage IN ('engaged','appointment','showed','won')) AS engaged,
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
END $$;
REVOKE EXECUTE ON FUNCTION public.lead_perf_pipeline(uuid[], timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_perf_pipeline(uuid[], timestamptz, timestamptz) TO authenticated, service_role;

-- =====================================================================
-- 4) lead_perf_agents
-- =====================================================================
CREATE OR REPLACE FUNCTION public.lead_perf_agents(
  _property_ids uuid[],
  _from timestamptz,
  _to timestamptz
) RETURNS TABLE(
  ghl_user_id text,
  agent_name text,
  property_count integer,
  assigned integer,
  contacted integer,
  contact_rate numeric,
  booked integer,
  booking_rate numeric,
  showed integer,
  show_rate numeric,
  won integer,
  win_rate numeric,
  median_human_raw_seconds numeric,
  median_human_business_seconds numeric,
  avg_human_attempts numeric,
  stale_count integer,
  critical_stale_count integer,
  low_sample boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
    SELECT lf.* FROM public.ghl_lead_facts lf
    WHERE lf.lead_created_at >= _from AND lf.lead_created_at <= _to
      AND lf.assigned_user_id IS NOT NULL
      AND (_property_ids IS NULL OR lf.property_id = ANY(_property_ids))
  ),
  agg AS (
    SELECT
      f.assigned_user_id,
      COUNT(DISTINCT f.property_id)::int AS property_count,
      COUNT(*)::int AS assigned,
      COUNT(*) FILTER (WHERE f.first_human_response_at IS NOT NULL)::int AS contacted,
      COUNT(*) FILTER (WHERE f.appointment_booked_at IS NOT NULL
        OR f.canonical_stage IN ('appointment','showed','won'))::int AS booked,
      COUNT(*) FILTER (WHERE f.appointment_showed_at IS NOT NULL
        OR f.canonical_stage IN ('showed','won'))::int AS showed,
      COUNT(*) FILTER (WHERE f.won_at IS NOT NULL OR f.canonical_stage = 'won')::int AS won,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY f.human_speed_to_lead_seconds_raw)
        FILTER (WHERE f.human_speed_to_lead_seconds_raw IS NOT NULL) AS median_raw,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY f.human_speed_to_lead_seconds_business)
        FILTER (WHERE f.human_speed_to_lead_seconds_business IS NOT NULL) AS median_business,
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
    a.median_raw,
    a.median_business,
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
END $$;
REVOKE EXECUTE ON FUNCTION public.lead_perf_agents(uuid[], timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_perf_agents(uuid[], timestamptz, timestamptz) TO authenticated, service_role;

-- =====================================================================
-- 5) lead_perf_quality
-- =====================================================================
CREATE OR REPLACE FUNCTION public.lead_perf_quality(
  _property_ids uuid[],
  _from timestamptz,
  _to timestamptz
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _result jsonb;
BEGIN
  PERFORM public.lead_perf_check_access(_property_ids);

  WITH facts AS (
    SELECT * FROM public.ghl_lead_facts lf
    WHERE lf.lead_created_at >= _from AND lf.lead_created_at <= _to
      AND (_property_ids IS NULL OR lf.property_id = ANY(_property_ids))
  ),
  unassigned AS (
    SELECT COUNT(*) AS n FROM facts WHERE assigned_user_id IS NULL
  ),
  missing_opp AS (
    SELECT COUNT(*) AS n FROM facts WHERE opportunity_id IS NULL
  ),
  no_disposition AS (
    SELECT COUNT(*) AS n FROM facts
    WHERE is_open = false AND won_at IS NULL AND lost_at IS NULL
  ),
  lost_no_reason AS (
    SELECT COUNT(*) AS n FROM facts
    WHERE lost_at IS NOT NULL
      AND (lost_reason_raw IS NULL OR length(trim(lost_reason_raw)) = 0)
  ),
  dup_contacts AS (
    SELECT COUNT(*) AS n FROM (
      SELECT property_id, duplicate_group_id
      FROM public.ghl_contacts
      WHERE duplicate_group_id IS NOT NULL
        AND (_property_ids IS NULL OR property_id = ANY(_property_ids))
      GROUP BY property_id, duplicate_group_id
      HAVING COUNT(*) > 1
    ) d
  ),
  dup_opps AS (
    SELECT COUNT(*) AS n FROM (
      SELECT property_id, contact_id
      FROM public.ghl_opportunities
      WHERE contact_id IS NOT NULL
        AND (_property_ids IS NULL OR property_id = ANY(_property_ids))
        AND ghl_created_at >= _from AND ghl_created_at <= _to
      GROUP BY property_id, contact_id
      HAVING COUNT(*) > 1
    ) d
  ),
  unmapped_stages AS (
    SELECT COUNT(*) AS n
    FROM public.ghl_pipeline_stages s
    WHERE (_property_ids IS NULL OR s.property_id = ANY(_property_ids))
      AND NOT EXISTS (
        SELECT 1 FROM public.property_pipeline_mapping m
        WHERE m.property_id = s.property_id
          AND m.ghl_stage_id = s.ghl_stage_id
          AND m.confirmed_by_user = true
      )
  ),
  unknown_source AS (
    SELECT COUNT(*) AS n
    FROM public.ghl_messages
    WHERE response_source = 'unknown'
      AND sent_at >= _from AND sent_at <= _to
      AND (_property_ids IS NULL OR property_id = ANY(_property_ids))
  ),
  facts_missing_contact AS (
    SELECT COUNT(*) AS n FROM facts WHERE contact_id IS NULL OR length(contact_id) = 0
  ),
  appts_missing_status AS (
    SELECT COUNT(*) AS n
    FROM public.ghl_appointments
    WHERE appointment_status = 'unknown'
      AND starts_at >= _from AND starts_at <= _to
      AND (_property_ids IS NULL OR property_id = ANY(_property_ids))
  )
  SELECT jsonb_build_object(
    'unassigned',               (SELECT n FROM unassigned),
    'missing_opportunities',    (SELECT n FROM missing_opp),
    'no_disposition',           (SELECT n FROM no_disposition),
    'duplicate_contacts',       (SELECT n FROM dup_contacts),
    'duplicate_opportunities',  (SELECT n FROM dup_opps),
    'lost_without_reason',      (SELECT n FROM lost_no_reason),
    'unmapped_stages',          (SELECT n FROM unmapped_stages),
    'unknown_response_source',  (SELECT n FROM unknown_source),
    'lead_facts_missing_contact', (SELECT n FROM facts_missing_contact),
    'appointments_missing_status', (SELECT n FROM appts_missing_status)
  ) INTO _result;

  RETURN _result;
END $$;
REVOKE EXECUTE ON FUNCTION public.lead_perf_quality(uuid[], timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_perf_quality(uuid[], timestamptz, timestamptz) TO authenticated, service_role;
