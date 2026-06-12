
CREATE OR REPLACE FUNCTION public.lead_perf_drill(
  _issue_type text,
  _property_ids uuid[],
  _from timestamptz,
  _to timestamptz,
  _limit integer DEFAULT 500
) RETURNS TABLE(
  property_id uuid,
  property_name text,
  contact_id text,
  contact_name text,
  phone text,
  email text,
  assigned_user_id text,
  agent_name text,
  lead_created_at timestamptz,
  stage_id text,
  stage_name text,
  canonical_stage public.ghl_canonical_stage,
  last_activity_at timestamptz,
  first_human_response_at timestamptz,
  speed_to_lead_seconds integer,
  human_attempt_count integer,
  issue_type text,
  ghl_deep_link text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _stale int;
  _critical int;
  _active_window int;
  _slow_threshold int;
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

  -- Base lead-fact join used for the lead-centric issue types.
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
    SELECT b.*, _issue_type AS itype
    FROM base b
    WHERE
      (_issue_type = 'never_responded'
        AND b.first_human_response_at IS NULL
        AND b.is_open = true)
   OR (_issue_type = 'currently_waiting'
        AND b.is_open = true
        AND b.first_human_response_at IS NULL
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
    f.property_id,
    f.p_name,
    f.contact_id,
    NULLIF(trim(COALESCE(f.first_name,'') || ' ' || COALESCE(f.last_name,'')), ''),
    f.c_phone, f.c_email,
    f.assigned_user_id, f.u_name,
    f.lead_created_at,
    f.stage_id, f.s_name,
    f.canonical_stage,
    f.last_activity_at, f.first_human_response_at,
    f.human_speed_to_lead_seconds_raw,
    f.human_attempt_count,
    f.itype,
    CASE WHEN f.loc_id IS NOT NULL AND f.contact_id IS NOT NULL
      THEN 'https://app.gohighlevel.com/v2/location/' || f.loc_id || '/contacts/detail/' || f.contact_id
      ELSE NULL END
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
      c.property_id, p.name,
      c.ghl_contact_id,
      NULLIF(trim(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')), ''),
      c.phone, c.email,
      c.assigned_user_id, u.name,
      NULL::timestamptz, NULL::text, NULL::text, NULL::public.ghl_canonical_stage,
      NULL::timestamptz, c.first_human_response_at,
      NULL::int, NULL::int,
      'duplicate_contacts'::text,
      CASE WHEN pds.config->>'location_id' IS NOT NULL
        THEN 'https://app.gohighlevel.com/v2/location/' || (pds.config->>'location_id') || '/contacts/detail/' || c.ghl_contact_id
        ELSE NULL END
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
      o.property_id, p.name,
      o.contact_id,
      NULLIF(trim(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')), ''),
      c.phone, c.email,
      o.assigned_to, u.name,
      o.ghl_created_at,
      o.stage_id, s.name, NULL::public.ghl_canonical_stage,
      o.ghl_updated_at, NULL::timestamptz,
      NULL::int, NULL::int,
      'duplicate_opportunities'::text,
      CASE WHEN pds.config->>'location_id' IS NOT NULL
        THEN 'https://app.gohighlevel.com/v2/location/' || (pds.config->>'location_id') || '/contacts/detail/' || o.contact_id
        ELSE NULL END
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
      m.property_id, p.name,
      m.contact_id,
      NULLIF(trim(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')), ''),
      c.phone, c.email,
      c.assigned_user_id, u.name,
      NULL::timestamptz,
      NULL::text, NULL::text, NULL::public.ghl_canonical_stage,
      m.sent_at, NULL::timestamptz,
      NULL::int, NULL::int,
      'unknown_response_source'::text,
      CASE WHEN pds.config->>'location_id' IS NOT NULL AND m.contact_id IS NOT NULL
        THEN 'https://app.gohighlevel.com/v2/location/' || (pds.config->>'location_id') || '/contacts/detail/' || m.contact_id
        ELSE NULL END
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
      a.property_id, p.name,
      a.contact_id,
      NULLIF(trim(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')), ''),
      c.phone, c.email,
      a.assigned_user_id, u.name,
      a.starts_at,
      NULL::text, NULL::text, NULL::public.ghl_canonical_stage,
      a.ends_at, NULL::timestamptz,
      NULL::int, NULL::int,
      'appointments_missing_status'::text,
      CASE WHEN pds.config->>'location_id' IS NOT NULL AND a.contact_id IS NOT NULL
        THEN 'https://app.gohighlevel.com/v2/location/' || (pds.config->>'location_id') || '/contacts/detail/' || a.contact_id
        ELSE NULL END
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
      s.property_id, p.name,
      NULL::text,
      s.name, NULL::text, NULL::text,
      NULL::text, NULL::text,
      NULL::timestamptz,
      s.ghl_stage_id, s.name, NULL::public.ghl_canonical_stage,
      NULL::timestamptz, NULL::timestamptz,
      NULL::int, NULL::int,
      'unmapped_stages'::text,
      NULL::text
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
END $$;

REVOKE EXECUTE ON FUNCTION public.lead_perf_drill(text, uuid[], timestamptz, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_perf_drill(text, uuid[], timestamptz, timestamptz, integer) TO authenticated, service_role;
