
-- 1. Suppression tag rules ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_tag(_t text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(
    regexp_replace(
      regexp_replace(lower(coalesce(_t,'')), '[^a-z0-9]+', ' ', 'g'),
      '\s+', ' ', 'g'
    )
  , '')
$$;

CREATE TABLE IF NOT EXISTS public.lead_perf_suppression_tags (
  tag_normalized text PRIMARY KEY,
  label text NOT NULL,
  reason_label text NOT NULL DEFAULT 'Excluded by tag',
  disqualifies boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.lead_perf_suppression_tags TO authenticated, anon;
GRANT ALL ON public.lead_perf_suppression_tags TO service_role;
ALTER TABLE public.lead_perf_suppression_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "suppression tags readable" ON public.lead_perf_suppression_tags;
CREATE POLICY "suppression tags readable" ON public.lead_perf_suppression_tags
  FOR SELECT TO authenticated, anon USING (true);
DROP POLICY IF EXISTS "suppression tags internal write" ON public.lead_perf_suppression_tags;
CREATE POLICY "suppression tags internal write" ON public.lead_perf_suppression_tags
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'internal'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'internal'::app_role));

INSERT INTO public.lead_perf_suppression_tags (tag_normalized, label, reason_label) VALUES
  ('wrong number',      'Wrong number',      'Excluded by tag: wrong number'),
  ('bad number',        'Bad number',        'Excluded by tag: bad number'),
  ('invalid number',    'Invalid number',    'Excluded by tag: invalid number'),
  ('duplicate',         'Duplicate',         'Excluded by tag: duplicate'),
  ('spam',              'Spam',              'Excluded by tag: spam'),
  ('test',              'Test',              'Excluded by tag: test'),
  ('bad lead',          'Bad lead',          'Excluded by tag: bad lead'),
  ('not interested',    'Not interested',    'Excluded by tag: not interested'),
  ('do not contact',    'Do not contact',    'Excluded by tag: do not contact'),
  ('dnc',               'DNC',               'Excluded by tag: dnc'),
  ('existing customer', 'Existing customer', 'Excluded by tag: existing customer'),
  ('sold',              'Sold',              'Excluded by tag: sold'),
  ('enrolled',          'Enrolled',          'Excluded by tag: enrolled'),
  ('booked',            'Booked',            'Excluded by tag: booked'),
  ('appointment booked','Appointment booked','Excluded by tag: appointment booked')
ON CONFLICT (tag_normalized) DO NOTHING;

-- 2. Lead-fact tag fields ----------------------------------------------------
ALTER TABLE public.ghl_lead_facts
  ADD COLUMN IF NOT EXISTS tag_names text[],
  ADD COLUMN IF NOT EXISTS suppressing_tag_names text[],
  ADD COLUMN IF NOT EXISTS suppresses_needs_first_response_by_tag boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_disqualified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS disqualification_reason text;

-- 3. Updated rebuild_lead_facts ---------------------------------------------
CREATE OR REPLACE FUNCTION public.rebuild_lead_facts(_property_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
      aa.booked_at, aa.showed_at, aa.no_show_at,
      ct.tag_names, ct.suppressing,
      (array_length(ct.suppressing, 1) > 0) AS has_supp_tag
    FROM base b
    LEFT JOIN out_agg    oa  ON oa.contact_id  = b.contact_id
    LEFT JOIN in_call_agg ica ON ica.contact_id = b.contact_id
    LEFT JOIN inbound_call_seen ics ON ics.contact_id = b.contact_id
    LEFT JOIN appt_agg   aa  ON aa.contact_id  = b.contact_id
    LEFT JOIN contact_tags ct ON ct.contact_id = b.contact_id
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
    handled_by_stage,
    tag_names, suppressing_tag_names, suppresses_needs_first_response_by_tag,
    is_disqualified, disqualification_reason,
    needs_first_response, needs_first_response_reason
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
    COALESCE(r.tag_names, ARRAY[]::text[]),
    COALESCE(r.suppressing, ARRAY[]::text[]),
    COALESCE(r.has_supp_tag, false),
    COALESCE(r.has_supp_tag, false),
    CASE WHEN COALESCE(r.has_supp_tag, false)
      THEN 'Tag: ' || array_to_string(r.suppressing, ', ')
      ELSE NULL END,
    -- needs_first_response: open + not handled + not tagged + no engagement
    (CASE WHEN r.opp_status IN ('won','lost','abandoned') THEN false ELSE true END)
      AND r.first_engagement IS NULL
      AND NOT r.handled_by_stage
      AND NOT COALESCE(r.has_supp_tag, false),
    -- reason
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

  -- Maintain ghl_contacts denormalized engagement fields
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

  -- Duplicate detection unchanged
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

-- 4. Drill function: add tag_names to return + disqualified_by_tag --------
DROP FUNCTION IF EXISTS public.lead_perf_drill(text, uuid[], timestamptz, timestamptz, int);

CREATE OR REPLACE FUNCTION public.lead_perf_drill(
  _issue_type text, _property_ids uuid[], _from timestamptz, _to timestamptz, _limit integer DEFAULT 500
)
RETURNS TABLE(
  property_id uuid, property_name text, contact_id text, contact_name text,
  phone text, email text, assigned_user_id text, agent_name text,
  lead_created_at timestamptz, stage_id text, stage_name text,
  canonical_stage public.ghl_canonical_stage,
  last_activity_at timestamptz, first_human_response_at timestamptz,
  speed_to_lead_seconds integer, human_attempt_count integer,
  issue_type text, ghl_deep_link text, reason text, tag_names text[]
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
        _issue_type IN ('currently_waiting','stale','critical_stale','disqualified_by_tag')
        OR (lf.lead_created_at >= _from AND lf.lead_created_at <= _to)
      )
  ),
  filtered AS (
    SELECT b.*, _issue_type AS itype,
      (CASE _issue_type
        WHEN 'never_responded' THEN COALESCE(b.needs_first_response_reason, 'No outbound human response · no answered inbound call')
        WHEN 'currently_waiting' THEN COALESCE(b.needs_first_response_reason, 'Open lead with no human engagement yet')
        WHEN 'stale' THEN 'No human activity for ' || _stale || 'h+'
        WHEN 'critical_stale' THEN 'No human activity for ' || _critical || 'h+'
        WHEN 'unassigned' THEN 'No agent assigned'
        WHEN 'missing_opportunity' THEN 'Contact has no opportunity record'
        WHEN 'lost_without_reason' THEN 'Marked lost without a reason'
        WHEN 'slow_response' THEN 'Human responded after ' || _slow_threshold || 's threshold'
        WHEN 'disqualified_by_tag' THEN COALESCE('Excluded by tag: ' || array_to_string(b.suppressing_tag_names, ', '), 'Disqualified by tag')
        ELSE NULL END) AS reason_text
    FROM base b
    WHERE
      (_issue_type = 'never_responded'
        AND b.needs_first_response = true)
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
        AND b.assigned_user_id IS NULL)
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
      c.phone, c.email, c.assigned_user_id, u.name,
      NULL::timestamptz, NULL::text, NULL::text, NULL::public.ghl_canonical_stage,
      NULL::timestamptz, c.first_human_response_at,
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
      'Multiple opportunities for the same contact'::text,
      COALESCE(c.tags, ARRAY[]::text[])
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
      'Outbound message could not be classified as human/automation/AI'::text,
      COALESCE(c.tags, ARRAY[]::text[])
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
      'Appointment has no showed / no-show status'::text,
      COALESCE(c.tags, ARRAY[]::text[])
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

-- 5. Quality: add disqualified_by_tag count ---------------------------------
CREATE OR REPLACE FUNCTION public.lead_perf_quality(_property_ids uuid[], _from timestamptz, _to timestamptz)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _result jsonb;
BEGIN
  PERFORM public.lead_perf_check_access(_property_ids);

  WITH facts AS (
    SELECT * FROM public.ghl_lead_facts lf
    WHERE lf.lead_created_at >= _from AND lf.lead_created_at <= _to
      AND (_property_ids IS NULL OR lf.property_id = ANY(_property_ids))
  )
  SELECT jsonb_build_object(
    'unassigned',               (SELECT COUNT(*) FROM facts WHERE assigned_user_id IS NULL),
    'missing_opportunities',    (SELECT COUNT(*) FROM facts WHERE opportunity_id IS NULL),
    'no_disposition',           (SELECT COUNT(*) FROM facts WHERE is_open = false AND won_at IS NULL AND lost_at IS NULL),
    'duplicate_contacts',       (SELECT COUNT(*) FROM (
        SELECT property_id, duplicate_group_id FROM public.ghl_contacts
        WHERE duplicate_group_id IS NOT NULL
          AND (_property_ids IS NULL OR property_id = ANY(_property_ids))
        GROUP BY property_id, duplicate_group_id HAVING COUNT(*) > 1
    ) d),
    'duplicate_opportunities',  (SELECT COUNT(*) FROM (
        SELECT property_id, contact_id FROM public.ghl_opportunities
        WHERE contact_id IS NOT NULL
          AND (_property_ids IS NULL OR property_id = ANY(_property_ids))
          AND ghl_created_at >= _from AND ghl_created_at <= _to
        GROUP BY property_id, contact_id HAVING COUNT(*) > 1
    ) d),
    'lost_without_reason',      (SELECT COUNT(*) FROM facts WHERE lost_at IS NOT NULL AND (lost_reason_raw IS NULL OR length(trim(lost_reason_raw)) = 0)),
    'unmapped_stages',          (SELECT COUNT(*) FROM public.ghl_pipeline_stages s
        WHERE (_property_ids IS NULL OR s.property_id = ANY(_property_ids))
          AND NOT EXISTS (SELECT 1 FROM public.property_pipeline_mapping m
            WHERE m.property_id = s.property_id AND m.ghl_stage_id = s.ghl_stage_id AND m.confirmed_by_user = true)
    ),
    'unknown_response_source',  (SELECT COUNT(*) FROM public.ghl_messages
        WHERE response_source = 'unknown'
          AND sent_at >= _from AND sent_at <= _to
          AND (_property_ids IS NULL OR property_id = ANY(_property_ids))
    ),
    'lead_facts_missing_contact', (SELECT COUNT(*) FROM facts WHERE contact_id IS NULL OR length(contact_id) = 0),
    'appointments_missing_status', (SELECT COUNT(*) FROM public.ghl_appointments
        WHERE appointment_status = 'unknown'
          AND starts_at >= _from AND starts_at <= _to
          AND (_property_ids IS NULL OR property_id = ANY(_property_ids))
    ),
    'disqualified_by_tag',      (SELECT COUNT(*) FROM facts WHERE is_disqualified = true)
  ) INTO _result;

  RETURN _result;
END $function$;
