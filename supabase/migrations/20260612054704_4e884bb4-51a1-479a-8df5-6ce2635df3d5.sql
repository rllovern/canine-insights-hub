
REVOKE EXECUTE ON FUNCTION public.lead_perf_can_read(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_perf_can_read(uuid, uuid) TO authenticated, service_role;
