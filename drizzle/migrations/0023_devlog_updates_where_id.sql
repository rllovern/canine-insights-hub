create or replace function public.mops_devlog_internal(_op text, _args jsonb)
returns jsonb language plpgsql security definer set search_path = public, mops as $$
declare
  res jsonb;
  lease_rows integer;
begin
  if _op = 'devlog_run_start' then
    update mops.dev_log_sync_state set run_started_at = now(), last_run_at = now()
      where id and (run_started_at is null or run_started_at < now() - interval '10 minutes');
    get diagnostics lease_rows = row_count;
    return jsonb_build_object('acquired', lease_rows > 0);

  elsif _op = 'devlog_run_finish' then
    update mops.dev_log_sync_state set run_started_at = null, last_success_at = now(),
      consecutive_failures = 0, last_error = null where id;
    return jsonb_build_object('ok', true);

  elsif _op = 'devlog_run_fail' then
    update mops.dev_log_sync_state set run_started_at = null,
      consecutive_failures = consecutive_failures + 1,
      last_error = left(coalesce(_args->>'error','unknown'), 500) where id;
    return jsonb_build_object('ok', true, 'consecutive_failures', (select consecutive_failures from mops.dev_log_sync_state where id));

  elsif _op = 'devlog_pending' then
    select coalesce(jsonb_agg(to_jsonb(e) order by e.day, e.created_at), '[]'::jsonb) into res
      from (select * from mops.dev_log_entries where synced_at is null limit 25) e;
    return res;

  elsif _op = 'devlog_day_task' then
    return jsonb_build_object('day', _args->>'day',
      'asana_task_gid', (select asana_task_gid from mops.dev_log_days where day = nullif(_args->>'day','')::date));

  elsif _op = 'devlog_set_day_task' then
    insert into mops.dev_log_days (day, asana_task_gid, synced_at) values (nullif(_args->>'day','')::date, _args->>'gid', now())
      on conflict (day) do update set asana_task_gid = excluded.asana_task_gid, synced_at = now();
    return jsonb_build_object('ok', true);

  elsif _op = 'devlog_mark_synced' then
    update mops.dev_log_entries set asana_subtask_gid = _args->>'gid', synced_at = now()
      where id = nullif(_args->>'id','')::uuid;
    return jsonb_build_object('ok', true);

  elsif _op = 'devlog_status' then
    select jsonb_build_object('sync', (select to_jsonb(s) from mops.dev_log_sync_state s where s.id),
      'pending', (select count(*) from mops.dev_log_entries where synced_at is null)) into res;
    return res;
  end if;

  return jsonb_build_object('error','unknown_op');
end $$;

revoke all on function public.mops_devlog_internal(text, jsonb) from public, anon, authenticated;
grant execute on function public.mops_devlog_internal(text, jsonb) to service_role;