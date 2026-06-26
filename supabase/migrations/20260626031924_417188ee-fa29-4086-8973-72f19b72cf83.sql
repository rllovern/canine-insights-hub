CREATE OR REPLACE FUNCTION public.get_api_health_summary()
 RETURNS TABLE(source text, property_id uuid, property_name text, is_connected boolean, last_success_at timestamp with time zone, last_failure_at timestamp with time zone, last_error_message text, last_run_status text, last_run_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      COALESCE(pds.is_connected, false) AS is_connected
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
$function$;