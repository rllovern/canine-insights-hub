-- 1. Let signed-out (anon) sessions evaluate role helpers instead of erroring.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO anon;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_all_properties_reader(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.can_access_property(uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.viewer_can_access(uuid, uuid) TO anon;

-- 2. Token-scoped campaign labels for the public report label rule.
CREATE OR REPLACE FUNCTION public.get_campaign_labels_by_report_token(_token text)
RETURNS TABLE(property_id uuid, campaign text, label_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cl.property_id, cl.campaign, cl.label_name
  FROM public.campaign_labels cl
  JOIN public.properties p ON p.id = cl.property_id
  WHERE p.public_report_token = _token AND p.is_active;
$$;
GRANT EXECUTE ON FUNCTION public.get_campaign_labels_by_report_token(text) TO anon, authenticated;

-- 3. Token-scoped won opportunities (Verified Sale tile on the client report).
CREATE OR REPLACE FUNCTION public.get_won_days_by_report_token(_token text, _from timestamptz, _to timestamptz)
RETURNS TABLE(won_at timestamptz, monetary_value numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.won_at, o.monetary_value
  FROM public.ghl_opportunities o
  JOIN public.properties p ON p.id = o.property_id
  WHERE p.public_report_token = _token AND p.is_active
    AND o.status = 'won' AND o.won_at IS NOT NULL
    AND o.won_at >= _from AND o.won_at <= _to;
$$;
GRANT EXECUTE ON FUNCTION public.get_won_days_by_report_token(text, timestamptz, timestamptz) TO anon, authenticated;

-- 4. Token-scoped won attribution (same mapping rules as ghl_won_attribution).
CREATE OR REPLACE FUNCTION public.ghl_won_attribution_by_report_token(_token text, _from date, _to date)
RETURNS TABLE(property_id uuid, won_day date, ad_source text, contact_method text, wins bigint, revenue numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH opp AS (
    SELECT
      o.property_id,
      (o.won_at AT TIME ZONE COALESCE(p.timezone, 'America/New_York'))::date AS won_day,
      COALESCE(o.raw->'attributions'->0, '{}'::jsonb) AS att,
      lower(COALESCE(o.raw->>'source', '')) AS src,
      COALESCE(o.monetary_value, 0) AS amount
    FROM public.ghl_opportunities o
    JOIN public.properties p ON p.id = o.property_id
    WHERE p.public_report_token = _token AND p.is_active
      AND o.status = 'won' AND o.won_at IS NOT NULL
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
  SELECT m.property_id, m.won_day, m.ad_source, m.contact_method,
         count(*)::bigint, COALESCE(sum(m.amount), 0)::numeric
  FROM mapped m GROUP BY 1,2,3,4;
$$;
GRANT EXECUTE ON FUNCTION public.ghl_won_attribution_by_report_token(text, date, date) TO anon, authenticated;