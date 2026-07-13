REVOKE EXECUTE ON FUNCTION public.get_api_health_summary() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_api_health_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_api_health_summary() TO service_role;