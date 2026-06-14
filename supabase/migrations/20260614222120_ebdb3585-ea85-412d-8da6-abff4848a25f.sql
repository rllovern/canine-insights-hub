CREATE OR REPLACE FUNCTION public.sync_verified_sales_daily_metrics(_property_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _written integer := 0;
BEGIN
  DELETE FROM public.daily_metrics
  WHERE property_id = _property_id
    AND ad_source = 'GHL Won'
    AND campaign = 'Verified Won';

  WITH won_by_day AS (
    SELECT
      property_id,
      (COALESCE(won_at, lead_created_at) AT TIME ZONE 'UTC')::date AS date,
      COUNT(*)::integer AS verified_sale
    FROM public.ghl_lead_facts
    WHERE property_id = _property_id
      AND (won_at IS NOT NULL OR canonical_stage = 'won')
    GROUP BY property_id, (COALESCE(won_at, lead_created_at) AT TIME ZONE 'UTC')::date
  )
  INSERT INTO public.daily_metrics (
    property_id, date, ad_source, campaign,
    cost, impressions, clicks, record_count, no_entry, leads,
    good_leads, bad_leads, spam, projected_sale, verified_sale,
    medicaid, sessions, users
  )
  SELECT
    property_id, date, 'GHL Won', 'Verified Won',
    0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, verified_sale,
    0, 0, 0
  FROM won_by_day
  ON CONFLICT (property_id, date, ad_source, campaign)
  DO UPDATE SET verified_sale = EXCLUDED.verified_sale;

  GET DIAGNOSTICS _written = ROW_COUNT;
  RETURN _written;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_verified_sales_daily_metrics(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_verified_sales_daily_metrics(uuid) TO service_role;