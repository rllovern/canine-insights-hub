CREATE OR REPLACE FUNCTION mops.refresh_signals() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  DROP TABLE IF EXISTS pg_temp._sig;
  CREATE TEMP TABLE _sig (property_id uuid, signal_key text, state text, reason text) ON COMMIT DROP;

  INSERT INTO _sig
  SELECT DISTINCT p.id, 'incident_' || i.source, 'action_required', 'Open ' || i.source || ' data incident since ' || to_char(i.opened_at, 'Mon DD')
  FROM public.data_source_incidents i
  JOIN public.properties p ON p.id = ANY(i.affected_property_ids)
  WHERE i.resolved_at IS NULL AND coalesce(i.muted,false) = false;

  INSERT INTO _sig
  SELECT d.property_id, 'spend_stopped', 'action_required',
         'No ad spend for 3 days (prior average $' || round(avg_prior)::text || '/day)'
  FROM (
    SELECT property_id,
      sum(cost) FILTER (WHERE date BETWEEN current_date - 3 AND current_date - 1) AS recent,
      sum(cost) FILTER (WHERE date BETWEEN current_date - 17 AND current_date - 4) / 14.0 AS avg_prior
    FROM public.daily_metrics WHERE date >= current_date - 17
    GROUP BY property_id
  ) d
  JOIN public.properties p ON p.id = d.property_id AND p.is_active
  WHERE coalesce(d.avg_prior,0) >= 20 AND coalesce(d.recent,0) = 0;

  INSERT INTO _sig
  SELECT d.property_id, 'good_leads_down', 'observing',
         'Good leads ' || coalesce(recent,0) || ' in last 14 days vs ~' || round(base14) || ' typical'
  FROM (
    SELECT property_id,
      sum(good_leads) FILTER (WHERE date BETWEEN current_date - 14 AND current_date - 1) AS recent,
      sum(good_leads) FILTER (WHERE date BETWEEN current_date - 42 AND current_date - 15) / 2.0 AS base14,
      sum(good_leads) FILTER (WHERE date BETWEEN current_date - 42 AND current_date - 15) AS base_n
    FROM public.daily_metrics WHERE date >= current_date - 42
    GROUP BY property_id
  ) d
  JOIN public.properties p ON p.id = d.property_id AND p.is_active
  WHERE coalesce(base_n,0) >= 10 AND coalesce(recent,0) <= base14 * 0.5;

  INSERT INTO _sig
  SELECT s.property_id, 'stale_' || s.source, 'observing', s.source || ' has not synced successfully in over 48 hours'
  FROM public.property_data_sources s
  JOIN public.properties p ON p.id = s.property_id AND p.is_active
  WHERE s.is_connected AND coalesce(s.alerts_muted,false) = false
    AND s.last_success_at < now() - interval '48 hours'
    AND NOT EXISTS (SELECT 1 FROM _sig x WHERE x.property_id = s.property_id AND x.signal_key = 'incident_' || s.source);

  UPDATE mops.ops_signals o SET resolved_at = now()
  WHERE o.resolved_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM _sig x WHERE x.property_id = o.property_id AND x.signal_key = o.signal_key);

  UPDATE mops.ops_signals o SET last_seen_at = now(), reason = x.reason, state = x.state
  FROM _sig x WHERE o.resolved_at IS NULL AND x.property_id = o.property_id AND x.signal_key = o.signal_key;

  INSERT INTO mops.ops_signals (property_id, signal_key, state, reason)
  SELECT x.property_id, x.signal_key, x.state, x.reason FROM _sig x
  WHERE NOT EXISTS (SELECT 1 FROM mops.ops_signals o WHERE o.resolved_at IS NULL AND o.property_id = x.property_id AND o.signal_key = x.signal_key)
    AND NOT (x.state = 'observing' AND EXISTS (SELECT 1 FROM mops.ops_signals o WHERE o.property_id = x.property_id AND o.signal_key = x.signal_key AND o.resolved_at > now() - interval '2 days'))
  ON CONFLICT DO NOTHING;

  DROP TABLE IF EXISTS pg_temp._sig;
END $$;
REVOKE ALL ON FUNCTION mops.refresh_signals() FROM PUBLIC, anon, service_role;