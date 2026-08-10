CREATE OR REPLACE FUNCTION public.count_wins_in_period(_property_id uuid, _from date, _to date)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(*)::bigint
  FROM public.ghl_opportunities o
  JOIN public.properties p ON p.id = o.property_id
  WHERE o.property_id = _property_id
    AND o.status = 'won' AND o.won_at IS NOT NULL
    AND (o.won_at AT TIME ZONE COALESCE(p.timezone, 'America/New_York'))::date BETWEEN _from AND _to;
$$;

CREATE OR REPLACE FUNCTION public.sum_won_revenue_in_period(_property_id uuid, _from date, _to date)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(COALESCE(o.monetary_value, 0)), 0)::numeric
  FROM public.ghl_opportunities o
  JOIN public.properties p ON p.id = o.property_id
  WHERE o.property_id = _property_id
    AND o.status = 'won' AND o.won_at IS NOT NULL
    AND (o.won_at AT TIME ZONE COALESCE(p.timezone, 'America/New_York'))::date BETWEEN _from AND _to;
$$;

REVOKE EXECUTE ON FUNCTION public.count_wins_in_period(uuid, date, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sum_won_revenue_in_period(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_wins_in_period(uuid, date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.sum_won_revenue_in_period(uuid, date, date) TO service_role;