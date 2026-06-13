
-- 1. Add default lead owner column
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS default_lead_owner_user_id text;

-- 2. Seed Payton as default owner for Ridgeside K9 Ashtabula
UPDATE public.properties
  SET default_lead_owner_user_id = 'qrb4uQIPGavp05GgJQZZ'
  WHERE id = 'ea92c5ce-dc2c-466f-8d9b-0b251a80621e';

-- 3. Rewrite lead_perf_drill with new return signature
DROP FUNCTION IF EXISTS public.lead_perf_drill(text, uuid[], timestamptz, timestamptz, integer);

CREATE OR REPLACE FUNCTION public.lead_perf_drill(
  _issue_type text,
  _property_ids uuid[],
  _from timestamptz,
  _to timestamptz,
  _limit integer DEFAULT 500
)
RETURNS TABLE(
  property_id uuid,
  property_name text,
  contact_id text,
  contact_name text,
  phone text,
  email text,
  assigned_user_id text,
  agent_name text,
  agent_is_default boolean,
  lead_created_at timestamptz,
  stage_id text,
  stage_name text,
  canonical_stage public.ghl_canonical_stage,
  last_activity_at timestamptz,
  last_activity_type text,
  first_human_response_at timestamptz,
  speed_to_lead_seconds integer,
  human_attempt_count integer,
  issue_type text,
  ghl_deep_link text,
  reason text,
  tag_names text[]
)
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
      -- recompute reason fresh
      (CASE _issue_type
        WHEN 'never_responded' THEN
          CASE
            WHEN b.assigned_user_id IS NULL AND b.default_owner_id IS NULL THEN
              'No human response · no answered inbound call · unassigned'
            ELSE
              'No human response · no answered inbound call'
          END
        WHEN 'currently_waiting' THEN 'Open lead with no human engagement yet'
        WHEN 'stale' THEN 'No human activity for ' || _stale || 'h+'
        WHEN 'critical_stale' THEN 'No human activity for ' || _critical || 'h+'
        WHEN 'unassigned' THEN 'No agent assigned · no property default owner'
        WHEN 'missing_opportunity' THEN 'Contact has no opportunity record'
        WHEN 'lost_without_reason' THEN 'Marked lost without a reason'
        WHEN 'slow_response' THEN 'Human responded after ' || _slow_threshold || 's threshold'
        WHEN 'disqualified_by_tag' THEN COALESCE('Excluded by tag: ' || array_to_string(b.suppressing_tag_names, ', '), 'Disqualified by tag')
        ELSE NULL END) AS reason_text
    FROM base b
    WHERE
      (_issue_type = 'never_responded' AND b.needs_first_response = true)
   OR (_issue_type = 'currently_waiting'
        AND b.is_open = true
        AND b.first_human_engagement_at IS NULL
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
        AND b.human_speed_to_lead_seconds_raw IS NOT NULL
        AND b.human_speed_to_lead_seconds_raw > _slow_threshold)
   OR (_issue_type = 'disqualified_by_tag'
        AND b.is_disqualified = true)
  ),
  with_activity AS (
    SELECT f.*,
      la.last_at, la.last_kind
    FROM filtered f
    LEFT JOIN LATERAL (
      SELECT
        x.sent_at AS last_at,
        CASE
          WHEN x.message_type = 'TYPE_CALL' AND x.direction = 'inbound' THEN
            CASE WHEN COALESCE(NULLIF(x.meta->'call'->>'duration','')::int, 0) >= 30
                 THEN 'answered inbound call'
                 ELSE 'inbound call' END
          WHEN x.message_type = 'TYPE_CALL' AND x.direction = 'outbound' THEN 'outbound call'
          WHEN x.direction = 'inbound' THEN 'message from lead'
          WHEN x.direction = 'outbound' AND x.response_source = 'human' THEN
            'human ' || COALESCE(lower(x.channel), 'message')
          WHEN x.direction = 'outbound' AND x.response_source IN ('automation','ai') THEN
            'automation ' || COALESCE(lower(x.channel), 'message')
          WHEN x.direction = 'outbound' THEN
            'outbound ' || COALESCE(lower(x.channel), 'message')
          ELSE 'activity'
        END AS last_kind
      FROM public.ghl_messages x
      WHERE x.property_id = f.property_id AND x.contact_id = f.contact_id
      ORDER BY x.sent_at DESC NULLS LAST
      LIMIT 1
    ) la ON true
  )
  SELECT
    wa.property_id, wa.p_name, wa.contact_id,
    NULLIF(trim(COALESCE(wa.first_name,'') || ' ' || COALESCE(wa.last_name,'')), ''),
    wa.c_phone, wa.c_email,
    wa.assigned_user_id,
    COALESCE(wa.u_name, wa.default_owner_name) AS agent_name,
    (wa.assigned_user_id IS NULL AND wa.default_owner_id IS NOT NULL) AS agent_is_default,
    wa.lead_created_at,
    wa.stage_id, wa.s_name, wa.canonical_stage,
    COALESCE(wa.last_activity_at, wa.last_at) AS last_activity_at,
    COALESCE(wa.last_kind,
      CASE WHEN wa.last_activity_at IS NULL THEN 'lead created' ELSE NULL END
    ) AS last_activity_type,
    wa.first_human_response_at,
    wa.human_speed_to_lead_seconds_raw, wa.human_attempt_count,
    wa.itype,
    CASE WHEN wa.loc_id IS NOT NULL AND wa.contact_id IS NOT NULL
      THEN 'https://app.gohighlevel.com/v2/location/' || wa.loc_id || '/contacts/detail/' || wa.contact_id
      ELSE NULL END,
    wa.reason_text,
    COALESCE(wa.tag_names, ARRAY[]::text[])
  FROM with_activity wa
  WHERE _issue_type IN (
    'never_responded','currently_waiting','stale','critical_stale','unassigned',
    'missing_opportunity','lost_without_reason','slow_response','disqualified_by_tag'
  )
  ORDER BY wa.lead_created_at DESC NULLS LAST
  LIMIT _limit;

  -- Remaining duplicate / unknown_response / appt / unmapped branches return empty new cols
  IF _issue_type = 'duplicate_contacts' THEN
    RETURN QUERY
    SELECT
      c.property_id, p.name, c.ghl_contact_id,
      NULLIF(trim(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')), ''),
      c.phone, c.email, c.assigned_user_id,
      COALESCE(u.name, du.name), (c.assigned_user_id IS NULL AND p.default_lead_owner_user_id IS NOT NULL),
      NULL::timestamptz, NULL::text, NULL::text, NULL::public.ghl_canonical_stage,
      NULL::timestamptz, NULL::text, c.first_human_response_at,
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
      o.ghl_updated_at, NULL::text, NULL::timestamptz,
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
    ORDER BY o.ghl_created_at DESC NULLS LAST
    LIMIT _limit;
  END IF;

  IF _issue_type = 'unknown_response_source' THEN
    RETURN QUERY
    SELECT
      m.property_id, p.name, m.contact_id,
      NULLIF(trim(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')), ''),
      c.phone, c.email, c.assigned_user_id,
      COALESCE(u.name, du.name), (c.assigned_user_id IS NULL AND p.default_lead_owner_user_id IS NOT NULL),
      NULL::timestamptz, NULL::text, NULL::text, NULL::public.ghl_canonical_stage,
      m.sent_at, NULL::text, NULL::timestamptz,
      NULL::int, NULL::int,
      'unknown_response_source'::text,
      CASE WHEN pds.config->>'location_id' IS NOT NULL AND m.contact_id IS NOT NULL
        THEN 'https://app.gohighlevel.com/v2/location/' || (pds.config->>'location_id') || '/contacts/detail/' || m.contact_id
        ELSE NULL END,
      'Outbound message could not be classified as human/automation/AI'::text,
      COALESCE(c.tags, ARRAY[]::text[])
    FROM public.ghl_messages m
    JOIN public.properties p ON p.id = m.property_id
    LEFT JOIN public.ghl_contacts c ON c.property_id = m.property_id AND c.ghl_contact_id = m.contact_id
    LEFT JOIN public.ghl_users u ON u.property_id = m.property_id AND u.ghl_user_id = c.assigned_user_id
    LEFT JOIN public.ghl_users du ON du.property_id = m.property_id AND du.ghl_user_id = p.default_lead_owner_user_id
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
      c.phone, c.email, a.assigned_user_id,
      COALESCE(u.name, du.name), (a.assigned_user_id IS NULL AND p.default_lead_owner_user_id IS NOT NULL),
      a.starts_at, NULL::text, NULL::text, NULL::public.ghl_canonical_stage,
      a.ends_at, NULL::text, NULL::timestamptz,
      NULL::int, NULL::int,
      'appointments_missing_status'::text,
      CASE WHEN pds.config->>'location_id' IS NOT NULL AND a.contact_id IS NOT NULL
        THEN 'https://app.gohighlevel.com/v2/location/' || (pds.config->>'location_id') || '/contacts/detail/' || a.contact_id
        ELSE NULL END,
      'Appointment has no showed / no-show status'::text,
      COALESCE(c.tags, ARRAY[]::text[])
    FROM public.ghl_appointments a
    JOIN public.properties p ON p.id = a.property_id
    LEFT JOIN public.ghl_contacts c ON c.property_id = a.property_id AND c.ghl_contact_id = a.contact_id
    LEFT JOIN public.ghl_users u ON u.property_id = a.property_id AND u.ghl_user_id = a.assigned_user_id
    LEFT JOIN public.ghl_users du ON du.property_id = a.property_id AND du.ghl_user_id = p.default_lead_owner_user_id
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
      NULL::text, NULL::text, false,
      NULL::timestamptz, s.ghl_stage_id, s.name, NULL::public.ghl_canonical_stage,
      NULL::timestamptz, NULL::text, NULL::timestamptz,
      NULL::int, NULL::int,
      'unmapped_stages'::text, NULL::text,
      'Pipeline stage has no confirmed mapping'::text,
      ARRAY[]::text[]
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
END;
$function$;
