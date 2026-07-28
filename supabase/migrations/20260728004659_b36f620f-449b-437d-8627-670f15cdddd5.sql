CREATE OR REPLACE FUNCTION public.ghl_won_attribution(
  _property_ids uuid[],
  _from date,
  _to date
)
RETURNS TABLE(
  property_id uuid,
  won_day date,
  ad_source text,
  contact_method text,
  wins bigint,
  revenue numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _pid uuid;
BEGIN
  IF _property_ids IS NULL THEN
    IF NOT public.is_all_properties_reader(auth.uid()) THEN
      RAISE EXCEPTION 'access denied';
    END IF;
  ELSE
    FOREACH _pid IN ARRAY _property_ids LOOP
      IF NOT public.can_access_property(auth.uid(), _pid) THEN
        RAISE EXCEPTION 'access denied';
      END IF;
    END LOOP;
  END IF;

  RETURN QUERY
  WITH opp AS (
    SELECT
      o.property_id,
      (o.won_at AT TIME ZONE COALESCE(p.timezone, 'America/New_York'))::date AS won_day,
      COALESCE(o.raw->'attributions'->0, '{}'::jsonb) AS att,
      lower(COALESCE(o.raw->>'source', '')) AS src,
      COALESCE(o.monetary_value, 0) AS amount
    FROM public.ghl_opportunities o
    JOIN public.properties p ON p.id = o.property_id
    WHERE o.status = 'won'
      AND o.won_at IS NOT NULL
      AND (_property_ids IS NULL OR o.property_id = ANY(_property_ids))
      AND (o.won_at AT TIME ZONE COALESCE(p.timezone, 'America/New_York'))::date BETWEEN _from AND _to
  ),
  mapped AS (
    SELECT
      o.property_id,
      o.won_day,
      CASE
        WHEN o.att->>'utmGclid' IS NOT NULL
          OR o.att->>'gbraid' IS NOT NULL
          OR o.att->>'wbraid' IS NOT NULL
          OR o.att->>'utmSessionSource' = 'Paid Search'
          OR o.src LIKE '%google ads%'
          OR o.src LIKE '%paid%'
          THEN 'Google PPC'
        WHEN o.att->>'utmSessionSource' = 'Organic Search' OR o.src LIKE '%organic%' THEN 'Organic'
        WHEN o.att->>'utmSessionSource' = 'Direct traffic' OR o.src = 'website' THEN 'Direct'
        WHEN o.att->>'utmSessionSource' = 'Referral' THEN 'Referral'
        WHEN o.att->>'utmSessionSource' = 'Social media' OR o.att->>'medium' = 'facebook' THEN 'Facebook'
        ELSE 'Unattributed'
      END AS ad_source,
      CASE o.att->>'medium'
        WHEN 'form' THEN 'Form'
        WHEN 'conversation' THEN 'Call/Message'
        WHEN 'calendar' THEN 'Booked appointment'
        WHEN 'manual' THEN 'Manual CRM'
        WHEN 'zapier' THEN 'Imported'
        WHEN 'facebook' THEN 'Social'
        ELSE 'Unknown'
      END AS contact_method,
      o.amount
    FROM opp o
  )
  SELECT
    m.property_id,
    m.won_day,
    m.ad_source,
    m.contact_method,
    count(*)::bigint AS wins,
    COALESCE(sum(m.amount), 0)::numeric AS revenue
  FROM mapped m
  GROUP BY 1, 2, 3, 4;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ghl_won_attribution(uuid[], date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ghl_won_attribution(uuid[], date, date) TO service_role;