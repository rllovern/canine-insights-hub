ALTER TABLE public.daily_metrics RENAME COLUMN admissions TO projected_sale;

ALTER TABLE public.daily_metrics
  ADD COLUMN IF NOT EXISTS verified_sale INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.daily_metrics.projected_sale IS 'CTM AI transcript projection that a sale likely occurred; provisional and not a verified closed sale.';
COMMENT ON COLUMN public.daily_metrics.verified_sale IS 'Verified GHL closed-won sale count only; must not be backfilled from projected_sale.';

ALTER TABLE public.property_targets
  ADD COLUMN IF NOT EXISTS cpgl_target NUMERIC;

UPDATE public.property_targets
SET cpgl_target = COALESCE(cpgl_target, cpl_target)
WHERE cpgl_target IS NULL AND cpl_target IS NOT NULL;

COMMENT ON COLUMN public.property_targets.cpl_target IS 'Target for cost per lead: spend divided by total leads.';
COMMENT ON COLUMN public.property_targets.cpgl_target IS 'Target for cost per good lead: spend divided by good leads.';

CREATE OR REPLACE FUNCTION public.ai_assistant_context(_property_id uuid, _from date, _to date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH src AS (
    SELECT * FROM public.daily_metrics
    WHERE property_id = _property_id AND date >= _from AND date <= _to
  )
  SELECT jsonb_build_object(
    'range', jsonb_build_object('from', _from, 'to', _to),
    'totals', (SELECT jsonb_build_object(
      'cost', COALESCE(SUM(cost),0),
      'impressions', COALESCE(SUM(impressions),0),
      'clicks', COALESCE(SUM(clicks),0),
      'calls', COALESCE(SUM(record_count),0),
      'good_leads', COALESCE(SUM(good_leads),0),
      'bad_leads', COALESCE(SUM(bad_leads),0),
      'projected_sale', COALESCE(SUM(projected_sale),0),
      'verified_sale', COALESCE(SUM(verified_sale),0),
      'spam', COALESCE(SUM(spam),0)
    ) FROM src),
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