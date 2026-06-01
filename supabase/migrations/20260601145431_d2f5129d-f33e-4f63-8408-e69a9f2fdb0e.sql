CREATE OR REPLACE FUNCTION public.get_cron_secret_v2()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret_v2' LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.get_cron_secret_v2() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cron_secret_v2() TO service_role;