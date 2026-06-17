-- Canonical lead-counts view: three exclusive real-lead tiers (bad, good, AI-projected).
-- total_leads = bad + good + projected (projected is NEVER inside good and NEVER subtracted).
-- quality_rate = (good + projected) / total.
CREATE OR REPLACE VIEW public.v_lead_counts_daily AS
SELECT
  dm.property_id,
  dm.date,
  dm.ad_source,
  dm.campaign,
  dm.cost,
  dm.record_count                                                   AS records,
  dm.no_entry,
  dm.spam,
  dm.bad_leads,
  dm.good_leads,
  dm.projected_sale                                                 AS projected_sales,
  dm.verified_sale                                                  AS verified_sales,
  (dm.bad_leads + dm.good_leads + dm.projected_sale)                AS total_leads,
  (dm.good_leads + dm.projected_sale)                               AS quality_numerator,
  CASE
    WHEN (dm.bad_leads + dm.good_leads + dm.projected_sale) > 0
      THEN (dm.good_leads + dm.projected_sale)::numeric
         / (dm.bad_leads + dm.good_leads + dm.projected_sale)
    ELSE NULL
  END                                                               AS quality_rate
FROM public.daily_metrics dm;

CREATE OR REPLACE VIEW public.v_lead_counts_property_daily AS
SELECT
  property_id,
  date,
  SUM(cost)               AS cost,
  SUM(records)            AS records,
  SUM(no_entry)           AS no_entry,
  SUM(spam)               AS spam,
  SUM(bad_leads)          AS bad_leads,
  SUM(good_leads)         AS good_leads,
  SUM(projected_sales)    AS projected_sales,
  SUM(verified_sales)     AS verified_sales,
  SUM(total_leads)        AS total_leads,
  SUM(quality_numerator)  AS quality_numerator,
  CASE WHEN SUM(total_leads) > 0
    THEN SUM(quality_numerator)::numeric / SUM(total_leads)
    ELSE NULL
  END                     AS quality_rate
FROM public.v_lead_counts_daily
GROUP BY property_id, date;

GRANT SELECT ON public.v_lead_counts_daily          TO authenticated, service_role;
GRANT SELECT ON public.v_lead_counts_property_daily TO authenticated, service_role;

-- Ratio-of-sums rollup. Always sums numerators and denominators across scope,
-- then divides. Never averages per-row rates.
CREATE OR REPLACE FUNCTION public.lead_quality_rollup(
  _property_ids uuid[],
  _from date,
  _to date
)
RETURNS TABLE(
  records bigint,
  no_entry bigint,
  spam bigint,
  bad bigint,
  good bigint,
  projected bigint,
  verified bigint,
  total bigint,
  quality_num bigint,
  quality_rate numeric,
  spend numeric,
  cpl numeric,
  cpgl numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT * FROM public.v_lead_counts_daily v
    WHERE v.date >= _from AND v.date <= _to
      AND (_property_ids IS NULL OR v.property_id = ANY(_property_ids))
      AND (
        public.has_role(auth.uid(), 'internal'::app_role)
        OR public.viewer_can_access(auth.uid(), v.property_id)
      )
  )
  SELECT
    COALESCE(SUM(records), 0)::bigint            AS records,
    COALESCE(SUM(no_entry), 0)::bigint           AS no_entry,
    COALESCE(SUM(spam), 0)::bigint               AS spam,
    COALESCE(SUM(bad_leads), 0)::bigint          AS bad,
    COALESCE(SUM(good_leads), 0)::bigint         AS good,
    COALESCE(SUM(projected_sales), 0)::bigint    AS projected,
    COALESCE(SUM(verified_sales), 0)::bigint     AS verified,
    COALESCE(SUM(total_leads), 0)::bigint        AS total,
    COALESCE(SUM(quality_numerator), 0)::bigint  AS quality_num,
    CASE WHEN COALESCE(SUM(total_leads), 0) > 0
      THEN SUM(quality_numerator)::numeric / SUM(total_leads)
      ELSE NULL END                              AS quality_rate,
    COALESCE(SUM(cost), 0)::numeric              AS spend,
    CASE WHEN COALESCE(SUM(total_leads), 0) > 0
      THEN SUM(cost)::numeric / SUM(total_leads)
      ELSE NULL END                              AS cpl,
    CASE WHEN COALESCE(SUM(good_leads + projected_sales), 0) > 0
      THEN SUM(cost)::numeric / SUM(good_leads + projected_sales)
      ELSE NULL END                              AS cpgl
  FROM base;
$$;

-- Public report token variant (no auth.uid required — scoped by token).
CREATE OR REPLACE FUNCTION public.lead_quality_rollup_by_report_token(
  _token text,
  _from date,
  _to date
)
RETURNS TABLE(
  records bigint,
  no_entry bigint,
  spam bigint,
  bad bigint,
  good bigint,
  projected bigint,
  verified bigint,
  total bigint,
  quality_num bigint,
  quality_rate numeric,
  spend numeric,
  cpl numeric,
  cpgl numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT v.*
    FROM public.v_lead_counts_daily v
    JOIN public.properties p ON p.id = v.property_id
    WHERE p.public_report_token = _token
      AND p.is_active = true
      AND v.date >= _from AND v.date <= _to
  )
  SELECT
    COALESCE(SUM(records), 0)::bigint,
    COALESCE(SUM(no_entry), 0)::bigint,
    COALESCE(SUM(spam), 0)::bigint,
    COALESCE(SUM(bad_leads), 0)::bigint,
    COALESCE(SUM(good_leads), 0)::bigint,
    COALESCE(SUM(projected_sales), 0)::bigint,
    COALESCE(SUM(verified_sales), 0)::bigint,
    COALESCE(SUM(total_leads), 0)::bigint,
    COALESCE(SUM(quality_numerator), 0)::bigint,
    CASE WHEN COALESCE(SUM(total_leads), 0) > 0
      THEN SUM(quality_numerator)::numeric / SUM(total_leads) ELSE NULL END,
    COALESCE(SUM(cost), 0)::numeric,
    CASE WHEN COALESCE(SUM(total_leads), 0) > 0
      THEN SUM(cost)::numeric / SUM(total_leads) ELSE NULL END,
    CASE WHEN COALESCE(SUM(good_leads + projected_sales), 0) > 0
      THEN SUM(cost)::numeric / SUM(good_leads + projected_sales) ELSE NULL END
  FROM base;
$$;

GRANT EXECUTE ON FUNCTION public.lead_quality_rollup(uuid[], date, date)            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lead_quality_rollup_by_report_token(text, date, date) TO anon, authenticated, service_role;