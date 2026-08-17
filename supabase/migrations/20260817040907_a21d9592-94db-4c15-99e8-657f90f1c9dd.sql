CREATE OR REPLACE FUNCTION public.ai_assistant_context(_property_id uuid, _from date, _to date)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH lab AS (
    SELECT campaign FROM public.campaign_labels WHERE property_id = _property_id
  ),
  src AS (
    SELECT dm.*
    FROM public.daily_metrics dm
    WHERE dm.property_id = _property_id
      AND dm.date >= _from AND dm.date <= _to
      AND dm.ad_source <> 'GHL Won'
      AND (
        dm.ad_source <> 'Google PPC'
        OR NOT EXISTS (SELECT 1 FROM lab)
        OR dm.campaign IN (SELECT campaign FROM lab)
      )
  ),
  rec AS (
    SELECT COALESCE(SUM(v.records), 0)::numeric AS records
    FROM public.v_lead_counts_daily v
    WHERE v.property_id = _property_id AND v.date >= _from AND v.date <= _to
  ),
  tot AS (
    SELECT
      COALESCE(SUM(cost),0)::numeric AS cost,
      COALESCE(SUM(impressions),0)::numeric AS impressions,
      COALESCE(SUM(clicks),0)::numeric AS clicks,
      COALESCE(SUM(good_leads),0)::numeric AS good_leads,
      COALESCE(SUM(bad_leads),0)::numeric AS bad_leads,
      COALESCE(SUM(projected_sale),0)::numeric AS projected_sale,
      COALESCE(SUM(verified_sale),0)::numeric AS verified_sale,
      COALESCE(SUM(spam),0)::numeric AS spam
    FROM src
  )
  SELECT jsonb_build_object(
    'range', jsonb_build_object('from', _from, 'to', _to),
    'totals', (
      SELECT jsonb_build_object(
        'cost', t.cost,
        'impressions', t.impressions,
        'clicks', t.clicks,
        'records', r.records,
        'calls', r.records,
        'good_leads', t.good_leads,
        'bad_leads', t.bad_leads,
        'projected_sale', t.projected_sale,
        'verified_sale', t.verified_sale,
        'spam', t.spam,
        'total_leads', t.good_leads + t.bad_leads + t.projected_sale,
        'quality_rate', CASE WHEN (t.good_leads + t.bad_leads + t.projected_sale) > 0
          THEN ROUND((t.good_leads + t.projected_sale) / (t.good_leads + t.bad_leads + t.projected_sale), 4)
          ELSE 0 END
      )
      FROM tot t CROSS JOIN rec r
    ),
    'by_source', (SELECT jsonb_agg(row_to_json(s)) FROM (
      SELECT ad_source,
        SUM(cost) AS cost,
        SUM(record_count) AS calls,
        SUM(good_leads) AS good_leads,
        SUM(bad_leads) AS bad_leads,
        SUM(projected_sale) AS projected_sale,
        SUM(verified_sale) AS verified_sale
      FROM src GROUP BY ad_source
    ) s)
  )
$function$;

CREATE OR REPLACE FUNCTION public.ai_assistant_context_multi(_property_ids uuid[], _from date, _to date)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH lab AS (
    SELECT property_id, campaign FROM public.campaign_labels
    WHERE property_id = ANY(_property_ids)
  ),
  labeled AS (
    SELECT DISTINCT property_id FROM lab
  ),
  src AS (
    SELECT dm.*
    FROM public.daily_metrics dm
    WHERE dm.property_id = ANY(_property_ids)
      AND dm.date >= _from AND dm.date <= _to
      AND dm.ad_source <> 'GHL Won'
      AND (
        dm.ad_source <> 'Google PPC'
        OR dm.property_id NOT IN (SELECT property_id FROM labeled)
        OR EXISTS (SELECT 1 FROM lab l WHERE l.property_id = dm.property_id AND l.campaign = dm.campaign)
      )
  ),
  rec AS (
    SELECT COALESCE(SUM(v.records), 0)::numeric AS records
    FROM public.v_lead_counts_daily v
    WHERE v.property_id = ANY(_property_ids) AND v.date >= _from AND v.date <= _to
  ),
  tot AS (
    SELECT
      COALESCE(SUM(cost),0)::numeric AS cost,
      COALESCE(SUM(impressions),0)::numeric AS impressions,
      COALESCE(SUM(clicks),0)::numeric AS clicks,
      COALESCE(SUM(good_leads),0)::numeric AS good_leads,
      COALESCE(SUM(bad_leads),0)::numeric AS bad_leads,
      COALESCE(SUM(projected_sale),0)::numeric AS projected_sale,
      COALESCE(SUM(verified_sale),0)::numeric AS verified_sale,
      COALESCE(SUM(spam),0)::numeric AS spam
    FROM src
  )
  SELECT jsonb_build_object(
    'range', jsonb_build_object('from', _from, 'to', _to),
    'totals', (
      SELECT jsonb_build_object(
        'cost', t.cost,
        'impressions', t.impressions,
        'clicks', t.clicks,
        'records', r.records,
        'calls', r.records,
        'good_leads', t.good_leads,
        'bad_leads', t.bad_leads,
        'projected_sale', t.projected_sale,
        'verified_sale', t.verified_sale,
        'spam', t.spam,
        'total_leads', t.good_leads + t.bad_leads + t.projected_sale,
        'quality_rate', CASE WHEN (t.good_leads + t.bad_leads + t.projected_sale) > 0
          THEN ROUND((t.good_leads + t.projected_sale) / (t.good_leads + t.bad_leads + t.projected_sale), 4)
          ELSE 0 END
      )
      FROM tot t CROSS JOIN rec r
    ),
    'by_property', (SELECT jsonb_agg(row_to_json(s)) FROM (
      SELECT property_id,
        SUM(cost) AS cost,
        SUM(good_leads) AS good_leads,
        SUM(bad_leads) AS bad_leads,
        SUM(projected_sale) AS projected_sale,
        SUM(verified_sale) AS verified_sale
      FROM src GROUP BY property_id
    ) s)
  )
$function$;

GRANT EXECUTE ON FUNCTION public.ai_assistant_context_multi(uuid[], date, date) TO authenticated, service_role;