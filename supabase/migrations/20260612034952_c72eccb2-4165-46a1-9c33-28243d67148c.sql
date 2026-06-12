
-- 1. Allow 'ghl' (and existing keyword_com) as a property data source
ALTER TABLE public.property_data_sources DROP CONSTRAINT IF EXISTS property_data_sources_source_check;
ALTER TABLE public.property_data_sources ADD CONSTRAINT property_data_sources_source_check
  CHECK (source = ANY (ARRAY['google_ads','ctm','ga4','keyword_com','ghl']));

-- 2. GHL contacts (typed surface + raw payload)
CREATE TABLE IF NOT EXISTS public.ghl_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  ghl_location_id text NOT NULL,
  ghl_contact_id text NOT NULL,
  first_name text,
  last_name text,
  email text,
  phone text,
  source text,
  assigned_to text,
  tags text[],
  pipeline_stage text,
  ghl_created_at timestamptz,
  first_response_at timestamptz,
  speed_to_lead_seconds integer,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, ghl_contact_id)
);
CREATE INDEX IF NOT EXISTS idx_ghl_contacts_property_created ON public.ghl_contacts(property_id, ghl_created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ghl_contacts TO authenticated;
GRANT ALL ON public.ghl_contacts TO service_role;
ALTER TABLE public.ghl_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Internal full access ghl_contacts" ON public.ghl_contacts
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'internal'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'internal'::app_role));

CREATE POLICY "Viewers read assigned ghl_contacts" ON public.ghl_contacts
  FOR SELECT TO authenticated
  USING (public.viewer_can_access(auth.uid(), property_id));

CREATE TRIGGER set_ghl_contacts_updated_at
  BEFORE UPDATE ON public.ghl_contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. GHL raw event archive — append-only catch-all
CREATE TABLE IF NOT EXISTS public.ghl_events_raw (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  ghl_location_id text NOT NULL,
  object_type text NOT NULL,        -- 'conversation' | 'message' | 'opportunity' | 'appointment' | 'note' | 'task' | ...
  ghl_object_id text NOT NULL,
  occurred_at timestamptz,
  raw jsonb NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, object_type, ghl_object_id)
);
CREATE INDEX IF NOT EXISTS idx_ghl_events_property_type_time ON public.ghl_events_raw(property_id, object_type, occurred_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ghl_events_raw TO authenticated;
GRANT ALL ON public.ghl_events_raw TO service_role;
ALTER TABLE public.ghl_events_raw ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Internal full access ghl_events_raw" ON public.ghl_events_raw
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'internal'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'internal'::app_role));

CREATE POLICY "Viewers read assigned ghl_events_raw" ON public.ghl_events_raw
  FOR SELECT TO authenticated
  USING (public.viewer_can_access(auth.uid(), property_id));

-- 4. Sync runs index on (source, started_at) for API health queries
CREATE INDEX IF NOT EXISTS idx_sync_runs_source_started ON public.sync_runs(source, started_at DESC);

-- 5. API Health summary RPC
CREATE OR REPLACE FUNCTION public.get_api_health_summary()
RETURNS TABLE (
  source text,
  property_id uuid,
  property_name text,
  is_connected boolean,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error_message text,
  last_run_status text,
  last_run_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'internal'::app_role) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  WITH sources AS (
    SELECT unnest(ARRAY['google_ads','ctm','ga4','keyword_com','ghl']) AS source
  ),
  props AS (
    SELECT p.id, p.name FROM public.properties p WHERE p.is_active = true
  ),
  pairs AS (
    SELECT s.source, p.id AS property_id, p.name AS property_name
    FROM sources s CROSS JOIN props p
  ),
  conn AS (
    SELECT pds.property_id, pds.source,
      (pds.status = 'connected')::boolean AS is_connected
    FROM public.property_data_sources pds
  ),
  last_success AS (
    SELECT DISTINCT ON (sr.property_id, sr.source)
      sr.property_id, sr.source, sr.started_at AS last_success_at
    FROM public.sync_runs sr
    WHERE sr.status = 'success'
    ORDER BY sr.property_id, sr.source, sr.started_at DESC
  ),
  last_failure AS (
    SELECT DISTINCT ON (sr.property_id, sr.source)
      sr.property_id, sr.source, sr.started_at AS last_failure_at,
      COALESCE(sr.error_message, sr.error) AS last_error_message
    FROM public.sync_runs sr
    WHERE sr.status = 'failure'
    ORDER BY sr.property_id, sr.source, sr.started_at DESC
  ),
  last_any AS (
    SELECT DISTINCT ON (sr.property_id, sr.source)
      sr.property_id, sr.source, sr.status AS last_run_status, sr.started_at AS last_run_at
    FROM public.sync_runs sr
    ORDER BY sr.property_id, sr.source, sr.started_at DESC
  )
  SELECT
    pr.source,
    pr.property_id,
    pr.property_name,
    COALESCE(c.is_connected, false) AS is_connected,
    ls.last_success_at,
    lf.last_failure_at,
    lf.last_error_message,
    la.last_run_status,
    la.last_run_at
  FROM pairs pr
  LEFT JOIN conn c ON c.property_id = pr.property_id AND c.source = pr.source
  LEFT JOIN last_success ls ON ls.property_id = pr.property_id AND ls.source = pr.source
  LEFT JOIN last_failure lf ON lf.property_id = pr.property_id AND lf.source = pr.source
  LEFT JOIN last_any la ON la.property_id = pr.property_id AND la.source = pr.source
  ORDER BY pr.source, pr.property_name;
END;
$$;
