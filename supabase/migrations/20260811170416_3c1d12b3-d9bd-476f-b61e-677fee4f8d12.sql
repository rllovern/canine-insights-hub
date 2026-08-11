CREATE OR REPLACE FUNCTION public.crm_connection_status(_property_ids uuid[] DEFAULT NULL)
RETURNS TABLE(property_id uuid, connected boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.property_id,
         (d.is_connected AND coalesce(d.status, '') <> 'paused') AS connected
  FROM public.property_data_sources d
  WHERE d.source = 'ghl'
    AND (_property_ids IS NULL OR d.property_id = ANY(_property_ids))
    AND public.can_access_property(auth.uid(), d.property_id)
$$;

GRANT EXECUTE ON FUNCTION public.crm_connection_status(uuid[]) TO authenticated;