-- lovable-cron-fallback-reviewed: one-time test run; the job unschedules itself on its first execution, so it runs once total.
SELECT cron.schedule('mops-ads-changes-once', '* * * * *', $$
  SELECT cron.unschedule('mops-ads-changes-once');
  SELECT net.http_post(
    url:='https://yptgdovnvmpgwcvfdnrq.supabase.co/functions/v1/mops-ads-changes-sync',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || public.get_cron_secret_v2()),
    body:='{}'::jsonb,
    timeout_milliseconds:=120000
  );
$$);