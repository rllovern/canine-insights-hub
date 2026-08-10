CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select case when auth.role() = 'anon' then false else exists (
    select 1 from public.user_roles where user_id = _user_id and role = _role) end
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select case when auth.role() = 'anon' then false else exists (
    select 1 from public.user_roles where user_id = _user_id and role in ('super_admin','admin')) end
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select case when auth.role() = 'anon' then false else exists (
    select 1 from public.user_roles where user_id = _user_id and role = 'super_admin') end
$$;

CREATE OR REPLACE FUNCTION public.is_all_properties_reader(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select case when auth.role() = 'anon' then false else exists (
    select 1 from public.user_roles where user_id = _user_id and role in ('super_admin','admin','owner')) end
$$;

CREATE OR REPLACE FUNCTION public.can_access_property(_user_id uuid, _property_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select case when auth.role() = 'anon' then false else (
    public.is_all_properties_reader(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = _user_id
        AND ur.role = 'location_owner'
        AND EXISTS (
          SELECT 1 FROM public.viewer_property_access vpa
          WHERE vpa.user_id = _user_id AND vpa.property_id = _property_id
        )
    )) end
$$;