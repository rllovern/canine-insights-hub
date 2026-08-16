REVOKE EXECUTE ON FUNCTION public.get_sync_freshness() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_sync_freshness() TO authenticated;