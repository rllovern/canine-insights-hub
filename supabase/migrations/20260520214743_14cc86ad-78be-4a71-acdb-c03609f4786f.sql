
CREATE OR REPLACE FUNCTION public.get_sync_cron_schedule()
RETURNS TABLE(jobid bigint, schedule text, active boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, cron
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'internal'::app_role) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
    SELECT j.jobid, j.schedule, j.active
    FROM cron.job j
    WHERE j.command ILIKE '%scheduled-sync-all%'
    ORDER BY j.jobid
    LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_sync_cron_schedule(_schedule text, _active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
DECLARE
  _jobid bigint;
BEGIN
  IF NOT public.has_role(auth.uid(), 'internal'::app_role) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT j.jobid INTO _jobid
    FROM cron.job j
    WHERE j.command ILIKE '%scheduled-sync-all%'
    ORDER BY j.jobid
    LIMIT 1;
  IF _jobid IS NULL THEN
    RAISE EXCEPTION 'sync cron job not found';
  END IF;
  PERFORM cron.alter_job(job_id := _jobid, schedule := _schedule, active := _active);
END;
$$;

REVOKE ALL ON FUNCTION public.get_sync_cron_schedule() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_sync_cron_schedule(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sync_cron_schedule() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_sync_cron_schedule(text, boolean) TO authenticated;
