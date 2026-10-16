
-- Private development decision log for the Lovable -> Asana daily sync.
-- Lives in the non-exposed mops schema; reachable only through the guarded
-- public.mops_devlog_api (granted user) and public.mops_devlog_internal (cron path).

create table mops.dev_log_days (
  day date primary key,
  asana_task_gid text,
  synced_at timestamptz,
  created_at timestamptz not null default now()
);

create table mops.dev_log_entries (
  id uuid primary key default gen_random_uuid(),
  day date not null references mops.dev_log_days(day),
  change_id text not null unique,
  title text not null,
  request_text text,
  why_text text,
  problem text,
  what_changed text,
  areas text,
  implementation text,
  status text not null default 'in_progress',
  testing text,
  outcome_expected text,
  outcome_actual text,
  followups text,
  lovable_ref text,
  retrospective boolean not null default false,
  asana_subtask_gid text,
  content_hash text,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index dev_log_entries_day on mops.dev_log_entries(day);

create table mops.dev_log_sync_state (
  id boolean primary key default true check (id),
  last_run_at timestamptz,
  last_success_at timestamptz,
  consecutive_failures integer not null default 0,
  last_error text,
  run_started_at timestamptz
);
insert into mops.dev_log_sync_state (id) values (true);

-- Granted-user entry point (same single-grant check as mops_api).
create or replace function public.mops_devlog_api(_actor uuid, _endpoint text, _op text, _args jsonb)
returns jsonb language plpgsql security definer set search_path = public, mops as $$
declare
  res jsonb;
  cid text;
  h text;
  d date;
begin
  if not mops.check_grant(_actor) then
    insert into mops.audit_log (actor, endpoint, op, outcome) values (_actor, _endpoint, _op, 'denied');
    return jsonb_build_object('error','not_found');
  end if;
  insert into mops.audit_log (actor, endpoint, op, outcome) values (_actor, _endpoint, _op, 'allowed');

  if _op = 'devlog_list' then
    select jsonb_build_object(
      'days', coalesce((select jsonb_agg(jsonb_build_object('day', dy.day, 'asana_task_gid', dy.asana_task_gid, 'synced_at', dy.synced_at,
        'entries', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at) from mops.dev_log_entries e where e.day = dy.day), '[]'::jsonb))
        order by dy.day desc) from mops.dev_log_days dy), '[]'::jsonb),
      'sync', (select to_jsonb(s) from mops.dev_log_sync_state s where s.id)
    ) into res;
    return res;

  elsif _op = 'devlog_status' then
    select jsonb_build_object(
      'sync', (select to_jsonb(s) from mops.dev_log_sync_state s where s.id),
      'pending', (select count(*) from mops.dev_log_entries where synced_at is null),
      'total', (select count(*) from mops.dev_log_entries)
    ) into res;
    return res;

  elsif _op = 'devlog_upsert' then
    cid := nullif(_args->>'change_id','');
    if cid is null or length(cid) > 120 then return jsonb_build_object('error','change_id required'); end if;
    if coalesce(nullif(_args->>'title',''),'') = '' then return jsonb_build_object('error','title required'); end if;
    d := coalesce(nullif(_args->>'day','')::date, (now() at time zone 'America/New_York')::date);
    insert into mops.dev_log_days (day) values (d) on conflict (day) do nothing;
    h := md5(concat_ws('|', _args->>'title', _args->>'request_text', _args->>'why_text', _args->>'problem',
      _args->>'what_changed', _args->>'areas', _args->>'implementation', _args->>'status',
      _args->>'testing', _args->>'outcome_expected', _args->>'outcome_actual', _args->>'followups', _args->>'lovable_ref'));
    insert into mops.dev_log_entries (day, change_id, title, request_text, why_text, problem, what_changed, areas,
        implementation, status, testing, outcome_expected, outcome_actual, followups, lovable_ref, retrospective, content_hash)
      values (d, cid, _args->>'title', _args->>'request_text', _args->>'why_text', _args->>'problem', _args->>'what_changed',
        _args->>'areas', _args->>'implementation', coalesce(nullif(_args->>'status',''),'in_progress'), _args->>'testing',
        _args->>'outcome_expected', _args->>'outcome_actual', _args->>'followups', _args->>'lovable_ref',
        coalesce((_args->>'retrospective')::boolean, false), h)
    on conflict (change_id) do update set
      title = excluded.title, request_text = excluded.request_text, why_text = excluded.why_text,
      problem = excluded.problem, what_changed = excluded.what_changed, areas = excluded.areas,
      implementation = excluded.implementation, status = excluded.status, testing = excluded.testing,
      outcome_expected = excluded.outcome_expected, outcome_actual = excluded.outcome_actual,
      followups = excluded.followups, lovable_ref = excluded.lovable_ref,
      content_hash = excluded.content_hash,
      -- a changed entry becomes pending again so the sync updates the existing Asana subtask in place
      synced_at = case when mops.dev_log_entries.content_hash is distinct from excluded.content_hash then null else mops.dev_log_entries.synced_at end,
      updated_at = now();
    return jsonb_build_object('ok', true, 'change_id', cid, 'day', d);
  end if;

  return jsonb_build_object('error','unknown_op');
end $$;

revoke all on function public.mops_devlog_api(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.mops_devlog_api(uuid, text, text, jsonb) to service_role;

-- Cron/internal entry point. Service role only; can never write entry content,
-- only read pending entries and record sync results.
create or replace function public.mops_devlog_internal(_op text, _args jsonb)
returns jsonb language plpgsql security definer set search_path = public, mops as $$
declare
  res jsonb;
  lease_ok boolean;
begin
  if _op = 'devlog_run_start' then
    update mops.dev_log_sync_state set run_started_at = now(), last_run_at = now()
      where run_started_at is null or run_started_at < now() - interval '10 minutes';
    get diagnostics lease_ok = row_count;
    return jsonb_build_object('acquired', lease_ok > 0);

  elsif _op = 'devlog_run_finish' then
    update mops.dev_log_sync_state set run_started_at = null, last_success_at = now(),
      consecutive_failures = 0, last_error = null;
    return jsonb_build_object('ok', true);

  elsif _op = 'devlog_run_fail' then
    update mops.dev_log_sync_state set run_started_at = null,
      consecutive_failures = consecutive_failures + 1,
      last_error = left(coalesce(_args->>'error','unknown'), 500);
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
