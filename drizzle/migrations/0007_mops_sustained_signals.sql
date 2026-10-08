ALTER TABLE mops.ops_signals ADD COLUMN IF NOT EXISTS confirmations int NOT NULL DEFAULT 1;
ALTER TABLE mops.ops_signals ADD COLUMN IF NOT EXISTS last_data_through date;

CREATE OR REPLACE FUNCTION mops.refresh_signals() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  DROP TABLE IF EXISTS pg_temp._sig;
  CREATE TEMP TABLE _sig (property_id uuid, signal_key text, state text, reason text, critical boolean, data_through date) ON COMMIT DROP;

  -- Critical: open data incidents (prompt escalation).
  INSERT INTO _sig
  SELECT DISTINCT p.id, 'incident_' || i.source, 'action_required', 'Open ' || i.source || ' data incident since ' || to_char(i.opened_at, 'Mon DD'), true, NULL::date
  FROM public.data_source_incidents i
  JOIN public.properties p ON p.id = ANY(i.affected_property_ids)
  WHERE i.resolved_at IS NULL AND coalesce(i.muted,false) = false;

  -- Critical: spend stopped (prompt escalation).
  INSERT INTO _sig
  SELECT d.property_id, 'spend_stopped', 'action_required',
         'No ad spend for 3 days (prior average $' || round(avg_prior)::text || '/day)', true, d.data_through
  FROM (
    SELECT property_id, max(date) AS data_through,
      sum(cost) FILTER (WHERE date BETWEEN current_date - 3 AND current_date - 1) AS recent,
      sum(cost) FILTER (WHERE date BETWEEN current_date - 17 AND current_date - 4) / 14.0 AS avg_prior
    FROM public.daily_metrics WHERE date >= current_date - 17
    GROUP BY property_id
  ) d
  JOIN public.properties p ON p.id = d.property_id AND p.is_active
  WHERE coalesce(d.avg_prior,0) >= 20 AND coalesce(d.recent,0) = 0;

  -- Noncritical: good-lead decline. Needs minimum sample, a >=50% drop, and a drop
  -- beyond the location's normal week-to-week volatility. Starts as Observing.
  INSERT INTO _sig
  SELECT d.property_id, 'good_leads_down', 'observing',
         'Good leads ' || coalesce(recent,0) || ' in last 14 days vs ~' || round(base14) || ' typical', false, d.data_through
  FROM (
    SELECT m.property_id, max(m.date) AS data_through,
      sum(m.good_leads) FILTER (WHERE m.date BETWEEN current_date - 14 AND current_date - 1) AS recent,
      sum(m.good_leads) FILTER (WHERE m.date BETWEEN current_date - 42 AND current_date - 15) / 2.0 AS base14,
      sum(m.good_leads) FILTER (WHERE m.date BETWEEN current_date - 42 AND current_date - 15) AS base_n,
      (SELECT stddev_samp(w.n) FROM (
         SELECT sum(m2.good_leads) n FROM public.daily_metrics m2
         WHERE m2.property_id = m.property_id AND m2.date BETWEEN current_date - 42 AND current_date - 15
         GROUP BY floor((current_date - m2.date - 15) / 7)) w) AS weekly_sd
    FROM public.daily_metrics m WHERE m.date >= current_date - 42
    GROUP BY m.property_id
  ) d
  JOIN public.properties p ON p.id = d.property_id AND p.is_active
  WHERE coalesce(base_n,0) >= 10
    AND coalesce(recent,0) <= base14 * 0.5
    AND coalesce(recent,0) < base14 - 2 * coalesce(weekly_sd,0) * sqrt(2);

  INSERT INTO _sig
  SELECT s.property_id, 'stale_' || s.source, 'observing', s.source || ' has not synced successfully in over 48 hours', false, NULL::date
  FROM public.property_data_sources s
  JOIN public.properties p ON p.id = s.property_id AND p.is_active
  WHERE s.is_connected AND coalesce(s.alerts_muted,false) = false
    AND s.last_success_at < now() - interval '48 hours'
    AND NOT EXISTS (SELECT 1 FROM _sig x WHERE x.property_id = s.property_id AND x.signal_key = 'incident_' || s.source);

  -- Automatic recovery.
  UPDATE mops.ops_signals o SET resolved_at = now()
  WHERE o.resolved_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM _sig x WHERE x.property_id = o.property_id AND x.signal_key = o.signal_key);

  -- Still present: count a confirmation only when newer data has arrived (an
  -- independent period). Re-checking unchanged data never counts. Noncritical
  -- signals escalate after 3 independent confirmations.
  UPDATE mops.ops_signals o SET
    last_seen_at = now(), reason = x.reason,
    confirmations = o.confirmations + CASE WHEN x.data_through IS NOT NULL AND x.data_through > coalesce(o.last_data_through, x.data_through) THEN 1 ELSE 0 END,
    last_data_through = greatest(coalesce(o.last_data_through, x.data_through), x.data_through),
    state = CASE
      WHEN x.critical THEN 'action_required'
      WHEN o.confirmations + CASE WHEN x.data_through IS NOT NULL AND x.data_through > coalesce(o.last_data_through, x.data_through) THEN 1 ELSE 0 END >= 3 THEN 'action_required'
      ELSE 'observing' END
  FROM _sig x WHERE o.resolved_at IS NULL AND x.property_id = o.property_id AND x.signal_key = o.signal_key;

  -- New signals (duplicate suppression via open-signal unique index; 2-day cooldown for noncritical re-opens).
  INSERT INTO mops.ops_signals (property_id, signal_key, state, reason, confirmations, last_data_through)
  SELECT x.property_id, x.signal_key, x.state, x.reason, 1, x.data_through FROM _sig x
  WHERE NOT EXISTS (SELECT 1 FROM mops.ops_signals o WHERE o.resolved_at IS NULL AND o.property_id = x.property_id AND o.signal_key = x.signal_key)
    AND NOT (NOT x.critical AND EXISTS (SELECT 1 FROM mops.ops_signals o WHERE o.property_id = x.property_id AND o.signal_key = x.signal_key AND o.resolved_at > now() - interval '2 days'))
  ON CONFLICT DO NOTHING;

  DROP TABLE IF EXISTS pg_temp._sig;
END $$;
REVOKE ALL ON FUNCTION mops.refresh_signals() FROM PUBLIC, anon, service_role;