DROP FUNCTION public.mops_probe_rpc();
REVOKE ALL ON SCHEMA mops_probe FROM service_role;
COMMENT ON SCHEMA mops_probe IS 'DEPRECATED: temporary compatibility-test objects (2026-10-08). Unused; safe to drop.';
COMMENT ON TABLE mops_probe.t IS 'DEPRECATED: compatibility test only.';
COMMENT ON TABLE mops_probe.g IS 'DEPRECATED: compatibility test only.';
SELECT cron.schedule('mops-ads-changes-daily', '20 7 * * *', $$
  SELECT net.http_post(
    url:='https://yptgdovnvmpgwcvfdnrq.supabase.co/functions/v1/mops-ads-changes-sync',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || public.get_cron_secret_v2()),
    body:='{}'::jsonb,
    timeout_milliseconds:=120000
  );
$$);