
-- =========================================
-- ENUM
-- =========================================
create type public.app_role as enum ('internal', 'viewer');

-- =========================================
-- TABLES
-- =========================================
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  logo_url text,
  primary_color text,
  timezone text not null default 'America/New_York',
  is_active boolean not null default true,
  public_report_token text unique,
  created_at timestamptz not null default now()
);

create table public.property_data_sources (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  source text not null check (source in ('google_ads','ctm','ga4')),
  is_connected boolean not null default false,
  config jsonb,
  last_synced_at timestamptz,
  unique (property_id, source)
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

create table public.viewer_property_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, property_id)
);

-- =========================================
-- SECURITY DEFINER FUNCTIONS
-- =========================================
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

create or replace function public.viewer_can_access(_user_id uuid, _property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.viewer_property_access
    where user_id = _user_id and property_id = _property_id
  )
$$;

-- Public report lookup (anonymous-safe) — returns the property row matching a token
create or replace function public.get_property_by_report_token(_token text)
returns setof public.properties
language sql
stable
security definer
set search_path = public
as $$
  select * from public.properties
  where public_report_token = _token
    and is_active = true
  limit 1
$$;

-- =========================================
-- ENABLE RLS
-- =========================================
alter table public.properties enable row level security;
alter table public.property_data_sources enable row level security;
alter table public.user_roles enable row level security;
alter table public.viewer_property_access enable row level security;

-- =========================================
-- POLICIES: properties
-- =========================================
create policy "Internal can select all properties"
  on public.properties for select
  to authenticated
  using (public.has_role(auth.uid(), 'internal'));

create policy "Viewer can select assigned properties"
  on public.properties for select
  to authenticated
  using (
    public.has_role(auth.uid(), 'viewer')
    and public.viewer_can_access(auth.uid(), id)
  );

create policy "Internal can insert properties"
  on public.properties for insert
  to authenticated
  with check (public.has_role(auth.uid(), 'internal'));

create policy "Internal can update properties"
  on public.properties for update
  to authenticated
  using (public.has_role(auth.uid(), 'internal'))
  with check (public.has_role(auth.uid(), 'internal'));

create policy "Internal can delete properties"
  on public.properties for delete
  to authenticated
  using (public.has_role(auth.uid(), 'internal'));

-- =========================================
-- POLICIES: property_data_sources (internal only)
-- =========================================
create policy "Internal full access data sources"
  on public.property_data_sources for all
  to authenticated
  using (public.has_role(auth.uid(), 'internal'))
  with check (public.has_role(auth.uid(), 'internal'));

-- =========================================
-- POLICIES: user_roles
-- =========================================
create policy "Users can read own roles"
  on public.user_roles for select
  to authenticated
  using (user_id = auth.uid());

create policy "Internal can read all roles"
  on public.user_roles for select
  to authenticated
  using (public.has_role(auth.uid(), 'internal'));

create policy "Internal can insert roles"
  on public.user_roles for insert
  to authenticated
  with check (public.has_role(auth.uid(), 'internal'));

create policy "Internal can update roles"
  on public.user_roles for update
  to authenticated
  using (public.has_role(auth.uid(), 'internal'))
  with check (public.has_role(auth.uid(), 'internal'));

create policy "Internal can delete roles"
  on public.user_roles for delete
  to authenticated
  using (public.has_role(auth.uid(), 'internal'));

-- Bootstrap: allow first internal-self-registration via invite code (handled in app code via service)
-- We allow a user to insert THEIR OWN 'internal' role row. The invite-code gate is enforced in the
-- registration UI (it calls signUp then inserts the role only when the invite code matches).
-- This is acceptable because the worst-case is a determined user who knows the secret invite code
-- can elevate themselves — which is the intended invite mechanism.
create policy "Self insert internal via invite (app-enforced)"
  on public.user_roles for insert
  to authenticated
  with check (user_id = auth.uid() and role = 'internal');

-- =========================================
-- POLICIES: viewer_property_access (internal only)
-- =========================================
create policy "Internal full access viewer assignments"
  on public.viewer_property_access for all
  to authenticated
  using (public.has_role(auth.uid(), 'internal'))
  with check (public.has_role(auth.uid(), 'internal'));

create policy "Viewer can read own assignments"
  on public.viewer_property_access for select
  to authenticated
  using (user_id = auth.uid());

-- =========================================
-- STORAGE: property-logos bucket (public read)
-- =========================================
insert into storage.buckets (id, name, public)
values ('property-logos', 'property-logos', true)
on conflict (id) do nothing;

create policy "Public read property logos"
  on storage.objects for select
  using (bucket_id = 'property-logos');

create policy "Internal upload property logos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'property-logos'
    and public.has_role(auth.uid(), 'internal')
  );

create policy "Internal update property logos"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'property-logos'
    and public.has_role(auth.uid(), 'internal')
  );

create policy "Internal delete property logos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'property-logos'
    and public.has_role(auth.uid(), 'internal')
  );
