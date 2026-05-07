REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.viewer_can_access(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.viewer_can_access(uuid, uuid) TO authenticated;