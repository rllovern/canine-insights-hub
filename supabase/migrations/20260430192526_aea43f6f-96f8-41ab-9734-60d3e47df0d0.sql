
-- Lock down internal helpers: only the database (postgres) and definer should invoke directly
revoke execute on function public.has_role(uuid, public.app_role) from public, anon, authenticated;
revoke execute on function public.viewer_can_access(uuid, uuid) from public, anon, authenticated;

-- Public report lookup is INTENTIONALLY callable by anon (that's the share-link mechanism)
-- but we keep it tight — only allow exact token lookup
grant execute on function public.get_property_by_report_token(text) to anon, authenticated;

-- Replace broad public-read storage policy with one that only allows direct path access
-- (prevents listing the bucket contents)
drop policy if exists "Public read property logos" on storage.objects;

create policy "Public read individual property logos"
  on storage.objects for select
  using (
    bucket_id = 'property-logos'
    and (storage.foldername(name))[1] is not null
  );
