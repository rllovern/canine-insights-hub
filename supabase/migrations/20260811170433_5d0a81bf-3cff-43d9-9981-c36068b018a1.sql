REVOKE EXECUTE ON FUNCTION public.crm_connection_status(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crm_connection_status(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.crm_connection_status(uuid[]) TO authenticated;