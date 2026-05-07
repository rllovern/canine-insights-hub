
-- Extend property_data_sources to match AlienX shape
ALTER TABLE public.property_data_sources
  ADD COLUMN IF NOT EXISTS external_account_id text,
  ADD COLUMN IF NOT EXISTS login_customer_id text,
  ADD COLUMN IF NOT EXISTS refresh_token text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'disconnected',
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- sync_runs additions
ALTER TABLE public.sync_runs
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;

-- Public report aliases (so ported AlienX components work unchanged)
CREATE OR REPLACE FUNCTION public.public_report_client(_token text)
RETURNS TABLE(id uuid, name text, slug text, logo_url text, brand_color text, metric_labels jsonb, hidden_metrics jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, name, slug, logo_url, COALESCE(brand_color, primary_color) AS brand_color, metric_labels, hidden_metrics
  FROM public.properties WHERE public_report_token = _token AND is_active = true LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.public_report_metrics(_token text, _from date, _to date)
RETURNS SETOF public.daily_metrics
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT dm.* FROM public.daily_metrics dm
  JOIN public.properties p ON p.id = dm.property_id
  WHERE p.public_report_token = _token AND p.is_active = true
    AND dm.date >= _from AND dm.date <= _to
  ORDER BY dm.date ASC
$$;

CREATE OR REPLACE FUNCTION public.public_report_score_mappings(_token text)
RETURNS SETOF public.property_call_score_mappings
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.* FROM public.property_call_score_mappings m
  JOIN public.properties p ON p.id = m.property_id
  WHERE p.public_report_token = _token AND p.is_active = true
$$;

GRANT EXECUTE ON FUNCTION public.public_report_client(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_report_metrics(text, date, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_report_score_mappings(text) TO anon, authenticated;

-- AI assistant context: simple rollups for current window
CREATE OR REPLACE FUNCTION public.ai_assistant_context(_property_id uuid, _from date, _to date)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
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
      'admissions', COALESCE(SUM(admissions),0),
      'spam', COALESCE(SUM(spam),0)
    ) FROM src),
    'by_source', (SELECT jsonb_agg(row_to_json(s)) FROM (
      SELECT ad_source,
        SUM(cost) AS cost, SUM(record_count) AS calls,
        SUM(good_leads) AS good_leads, SUM(admissions) AS admissions
      FROM src GROUP BY ad_source
    ) s)
  )
$$;

CREATE OR REPLACE FUNCTION public.public_ai_assistant_context(_token text, _from date, _to date)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.ai_assistant_context(p.id, _from, _to)
  FROM public.properties p
  WHERE p.public_report_token = _token AND p.is_active = true
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.ai_assistant_context(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_ai_assistant_context(text, date, date) TO anon, authenticated;
