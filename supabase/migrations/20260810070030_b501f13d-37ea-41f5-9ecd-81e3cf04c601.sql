CREATE OR REPLACE FUNCTION public.viewer_can_access(_user_id uuid, _property_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select case when auth.role() = 'anon' then false else exists (
    select 1 from public.viewer_property_access
    where user_id = _user_id and property_id = _property_id) end
$$;