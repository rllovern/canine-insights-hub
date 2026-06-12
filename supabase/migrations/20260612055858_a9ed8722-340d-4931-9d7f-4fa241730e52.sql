
CREATE OR REPLACE FUNCTION public.seed_pipeline_mapping_suggestions(_property_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r int := 0;
BEGIN
  INSERT INTO public.property_pipeline_mapping
    (property_id, ghl_stage_id, ghl_pipeline_id, canonical_stage, suggested_canonical_stage, confirmed_by_user)
  SELECT
    s.property_id,
    s.ghl_stage_id,
    s.ghl_pipeline_id,
    (CASE
      WHEN s.name ~* '(book|schedul|appoint)'                              THEN 'appointment'
      WHEN s.name ~* '(show|attend)'                                       THEN 'showed'
      WHEN s.name ~* '(won|sold|paid|admit|closed.?won)'                   THEN 'won'
      WHEN s.name ~* '(lost|no.?show|bad.?fit|disqualif|closed.?lost)'     THEN 'lost'
      WHEN s.name ~* '(replied|engaged|qualif|warm)'                       THEN 'engaged'
      WHEN s.name ~* '(contact|call|text|reach)'                           THEN 'contacted'
      WHEN s.name ~* '(new|fresh|lead)'                                    THEN 'new'
      ELSE 'ignore'
    END)::public.ghl_canonical_stage,
    (CASE
      WHEN s.name ~* '(book|schedul|appoint)'                              THEN 'appointment'
      WHEN s.name ~* '(show|attend)'                                       THEN 'showed'
      WHEN s.name ~* '(won|sold|paid|admit|closed.?won)'                   THEN 'won'
      WHEN s.name ~* '(lost|no.?show|bad.?fit|disqualif|closed.?lost)'     THEN 'lost'
      WHEN s.name ~* '(replied|engaged|qualif|warm)'                       THEN 'engaged'
      WHEN s.name ~* '(contact|call|text|reach)'                           THEN 'contacted'
      WHEN s.name ~* '(new|fresh|lead)'                                    THEN 'new'
      ELSE 'ignore'
    END)::public.ghl_canonical_stage,
    false
  FROM public.ghl_pipeline_stages s
  WHERE s.property_id = _property_id
  ON CONFLICT (property_id, ghl_stage_id) DO NOTHING;
  GET DIAGNOSTICS _r = ROW_COUNT;
  RETURN _r;
END $$;

REVOKE EXECUTE ON FUNCTION public.seed_pipeline_mapping_suggestions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_pipeline_mapping_suggestions(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- rebuild_lead_facts
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rebuild_lead_facts(_property_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _written int := 0;
BEGIN
  DELETE FROM public.ghl_lead_facts WHERE property_id = _property_id;

  WITH
  msg_agg AS (
    SELECT
      m.contact_id,
      MIN(m.sent_at) FILTER (WHERE m.direction = 'outbound')                                              AS first_any,
      MIN(m.sent_at) FILTER (WHERE m.direction = 'outbound' AND m.response_source = 'human')              AS first_human,
      MIN(m.sent_at) FILTER (WHERE m.direction = 'outbound' AND m.response_source = 'automation')         AS first_auto,
      MIN(m.sent_at) FILTER (WHERE m.direction = 'outbound' AND m.response_source = 'ai')                 AS first_ai,
      COUNT(*) FILTER (WHERE m.direction = 'outbound' AND m.response_source = 'human')::int               AS human_attempts,
      COUNT(*) FILTER (WHERE m.direction = 'outbound' AND m.response_source = 'automation')::int          AS auto_touches,
      COUNT(*) FILTER (WHERE m.direction = 'outbound' AND m.response_source = 'ai')::int                  AS ai_touches,
      COUNT(*) FILTER (WHERE m.direction = 'outbound')::int                                               AS total_touches,
      MAX(m.sent_at) FILTER (WHERE m.direction = 'outbound' AND m.response_source = 'human')              AS last_human_activity,
      MAX(m.sent_at)                                                                                      AS last_activity,
      (ARRAY_AGG(m.channel ORDER BY m.sent_at)
        FILTER (WHERE m.direction = 'outbound' AND m.response_source = 'human'))[1]                       AS first_human_channel
    FROM public.ghl_messages m
    WHERE m.property_id = _property_id AND m.contact_id IS NOT NULL
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
  )
  INSERT INTO public.ghl_lead_facts (
    property_id, contact_id, opportunity_id, assigned_user_id,
    pipeline_id, stage_id, canonical_stage, lead_created_at,
    first_any_response_at, first_human_response_at, first_automation_response_at, first_ai_response_at,
    first_human_response_channel,
    human_speed_to_lead_seconds_raw,
    human_attempt_count, automation_touch_count, ai_touch_count, total_touch_count,
    appointment_booked_at, appointment_showed_at, appointment_no_show_at,
    won_at, lost_at, lost_reason_raw, lost_reason_normalized, monetary_value,
    is_open, last_human_activity_at, last_activity_at
  )
  SELECT
    _property_id, b.contact_id, b.opportunity_id, b.assigned_user_id,
    b.pipeline_id, b.stage_id, m.canonical_stage, b.lead_created_at,
    ma.first_any, ma.first_human, ma.first_auto, ma.first_ai,
    ma.first_human_channel,
    CASE WHEN ma.first_human IS NOT NULL
      THEN GREATEST(0, EXTRACT(EPOCH FROM (ma.first_human - b.lead_created_at))::int)
      ELSE NULL END,
    COALESCE(ma.human_attempts, 0),
    COALESCE(ma.auto_touches,   0),
    COALESCE(ma.ai_touches,     0),
    COALESCE(ma.total_touches,  0),
    aa.booked_at, aa.showed_at, aa.no_show_at,
    b.won_at, b.lost_at, b.lost_reason_raw, b.lost_reason_normalized, b.monetary_value,
    CASE
      WHEN b.opp_status IN ('won','lost','abandoned') THEN false
      ELSE true
    END,
    ma.last_human_activity, ma.last_activity
  FROM base b
  LEFT JOIN msg_agg  ma ON ma.contact_id = b.contact_id
  LEFT JOIN appt_agg aa ON aa.contact_id = b.contact_id
  LEFT JOIN public.property_pipeline_mapping m
    ON m.property_id = _property_id AND m.ghl_stage_id = b.stage_id;

  GET DIAGNOSTICS _written = ROW_COUNT;

  -- Refresh convenience cols on ghl_contacts
  WITH ma AS (
    SELECT contact_id,
      MIN(sent_at) FILTER (WHERE direction='outbound' AND response_source='human') AS first_human,
      MAX(sent_at) FILTER (WHERE direction='outbound' AND response_source='human') AS last_human
    FROM public.ghl_messages WHERE property_id = _property_id AND contact_id IS NOT NULL
    GROUP BY contact_id
  ),
  latest_opp AS (
    SELECT DISTINCT ON (contact_id) contact_id, ghl_opportunity_id
    FROM public.ghl_opportunities WHERE property_id = _property_id AND contact_id IS NOT NULL
    ORDER BY contact_id, ghl_created_at DESC NULLS LAST
  )
  UPDATE public.ghl_contacts c
  SET first_human_response_at  = ma.first_human,
      latest_human_response_at = ma.last_human,
      has_opportunity          = (lo.ghl_opportunity_id IS NOT NULL),
      latest_opportunity_id    = lo.ghl_opportunity_id
  FROM (SELECT c2.ghl_contact_id FROM public.ghl_contacts c2 WHERE c2.property_id = _property_id) ids
  LEFT JOIN ma         ON ma.contact_id        = ids.ghl_contact_id
  LEFT JOIN latest_opp lo ON lo.contact_id     = ids.ghl_contact_id
  WHERE c.property_id = _property_id AND c.ghl_contact_id = ids.ghl_contact_id;

  -- Duplicate detection (normalized phone or lowercased email)
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
END $$;

REVOKE EXECUTE ON FUNCTION public.rebuild_lead_facts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rebuild_lead_facts(uuid) TO authenticated, service_role;
