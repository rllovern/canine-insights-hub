CREATE OR REPLACE FUNCTION public.user_can_access_property(_user_id uuid, _property_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.has_role(_user_id, 'internal'::app_role)
      OR public.is_all_properties_reader(_user_id)
      OR public.viewer_can_access(_user_id, _property_id)
$function$;