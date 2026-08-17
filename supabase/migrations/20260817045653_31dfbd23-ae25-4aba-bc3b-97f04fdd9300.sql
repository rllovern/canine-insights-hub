CREATE OR REPLACE FUNCTION public.ai_assistant_context(_property_id uuid, _from date, _to date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH lab AS (
    SELECT campaign FROM public.campaign_labels WHERE property_id = _property_id
  ),
  -- Campaign names that really belong to a Google Ads account: anything that
  -- carries delivery signals, plus anything labeled to some property.
  -- Call-tracking rows under 'Google PPC' (cost/impressions/clicks all zero,
  -- generic names like 'Google Ads') are NOT ads campaigns and must never be
  -- dropped by the shared-account allow-list.
  ads_campaigns AS (
    SELECT campaign FROM public.campaign_labels
    UNION
    SELECT DISTINCT dm.campaign
    FROM public.daily_metrics dm
    WHERE dm.ad_source = 'Google PPC'
      AND (COALESCE(dm.cost,0) > 0 OR COALESCE(dm.impressions,0) > 0 OR COALESCE(dm.clicks,0) > 0)
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
        OR dm.campaign NOT IN (SELECT campaign FROM ads_campaigns)
      )
  ),
  tot AS (
    SELECT
      COALESCE(SUM(cost),0)::numeric AS cost,
      COALESCE(SUM(impressions),0)::numeric AS impressions,
      COALESCE(SUM(clicks),0)::numeric AS clicks,
      COALESCE(SUM(record_count),0)::numeric AS records,
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
        'records', t.records,
        'calls', t.records,
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
      FROM tot t
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
  ads_campaigns AS (
    SELECT campaign FROM public.campaign_labels
    UNION
    SELECT DISTINCT dm.campaign
    FROM public.daily_metrics dm
    WHERE dm.ad_source = 'Google PPC'
      AND (COALESCE(dm.cost,0) > 0 OR COALESCE(dm.impressions,0) > 0 OR COALESCE(dm.clicks,0) > 0)
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
        OR dm.campaign NOT IN (SELECT campaign FROM ads_campaigns)
      )
  ),
  tot AS (
    SELECT
      COALESCE(SUM(cost),0)::numeric AS cost,
      COALESCE(SUM(impressions),0)::numeric AS impressions,
      COALESCE(SUM(clicks),0)::numeric AS clicks,
      COALESCE(SUM(record_count),0)::numeric AS records,
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
        'records', t.records,
        'calls', t.records,
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
      FROM tot t
    ),
    'by_property', (SELECT jsonb_agg(row_to_json(s)) FROM (
      SELECT property_id,
        SUM(cost) AS cost,
        SUM(record_count) AS records,
        SUM(good_leads) AS good_leads,
        SUM(bad_leads) AS bad_leads,
        SUM(projected_sale) AS projected_sale,
        SUM(verified_sale) AS verified_sale
      FROM src GROUP BY property_id
    ) s)
  )
$function$;