ALTER TABLE public.property_data_sources
  ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_success_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_failure_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_failed_phase text,
  ADD COLUMN IF NOT EXISTS backoff_until timestamptz;

ALTER TABLE public.sync_runs
  ADD COLUMN IF NOT EXISTS phase text;

CREATE INDEX IF NOT EXISTS sync_runs_property_source_started_idx
  ON public.sync_runs (property_id, source, started_at DESC);

-- Seed last_success_at from history so the freshness line is meaningful today.
UPDATE public.property_data_sources pds
SET last_success_at = s.last_ok
FROM (
  SELECT property_id, source, max(started_at) AS last_ok
  FROM public.sync_runs WHERE status = 'success' GROUP BY 1,2
) s
WHERE s.property_id = pds.property_id AND s.source = pds.source
  AND pds.last_success_at IS NULL;

CREATE OR REPLACE FUNCTION public.report_data_freshness(_token text)
RETURNS TABLE(source text, last_success_at timestamptz, consecutive_failures integer, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pds.source, pds.last_success_at, pds.consecutive_failures, pds.status
  FROM public.property_data_sources pds
  JOIN public.properties p ON p.id = pds.property_id
  WHERE p.public_report_token = _token
    AND _token IS NOT NULL
    AND pds.is_connected = true
$$;

GRANT EXECUTE ON FUNCTION public.report_data_freshness(text) TO anon, authenticated, service_role;