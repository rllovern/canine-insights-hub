alter table mops.dev_log_entries add column if not exists narrative text, add column if not exists implemented_at timestamptz;
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
      _args->>'testing', _args->>'outcome_expected', _args->>'outcome_actual', _args->>'followups', _args->>'lovable_ref', _args->>'narrative', _args->>'implemented_at'));
    insert into mops.dev_log_entries (day, change_id, title, request_text, why_text, problem, what_changed, areas,
        implementation, status, testing, outcome_expected, outcome_actual, followups, lovable_ref, retrospective, content_hash, narrative, implemented_at)
      values (d, cid, _args->>'title', _args->>'request_text', _args->>'why_text', _args->>'problem', _args->>'what_changed',
        _args->>'areas', _args->>'implementation', coalesce(nullif(_args->>'status',''),'in_progress'), _args->>'testing',
        _args->>'outcome_expected', _args->>'outcome_actual', _args->>'followups', _args->>'lovable_ref',
        coalesce((_args->>'retrospective')::boolean, false), h, _args->>'narrative', nullif(_args->>'implemented_at','')::timestamptz)
    on conflict (change_id) do update set
      title = excluded.title, request_text = excluded.request_text, why_text = excluded.why_text,
      problem = excluded.problem, what_changed = excluded.what_changed, areas = excluded.areas,
      implementation = excluded.implementation, status = excluded.status, testing = excluded.testing,
      outcome_expected = excluded.outcome_expected, outcome_actual = excluded.outcome_actual,
      followups = excluded.followups, lovable_ref = excluded.lovable_ref, narrative = excluded.narrative, implemented_at = excluded.implemented_at,
      content_hash = excluded.content_hash,
      synced_at = case when mops.dev_log_entries.content_hash is distinct from excluded.content_hash then null else mops.dev_log_entries.synced_at end,
      updated_at = now();
    return jsonb_build_object('ok', true, 'change_id', cid, 'day', d);
  end if;

  return jsonb_build_object('error','unknown_op');
end $$;

revoke all on function public.mops_devlog_api(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.mops_devlog_api(uuid, text, text, jsonb) to service_role;