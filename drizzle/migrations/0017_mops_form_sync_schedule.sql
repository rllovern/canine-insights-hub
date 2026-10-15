-- lovable-cron-fallback-reviewed: user-required 5-minute recovery of GHL form submissions missed by WordPress; GHL forms have no reliable submission webhook in this integration and missed leads must reach CTM within ~30 min.
SELECT cron.schedule('mops-form-sync-5min', '*/5 * * * *', $$
  SELECT net.http_post(
    url:='https://yptgdovnvmpgwcvfdnrq.supabase.co/functions/v1/mops-form-sync',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || public.get_cron_secret_v2()),
    body:='{"scheduled":true}'::jsonb,
    timeout_milliseconds:=120000
  );
$$);