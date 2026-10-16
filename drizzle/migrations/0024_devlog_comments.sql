create table if not exists mops.dev_log_comments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references mops.dev_log_entries(id),
  change_id text not null,
  content_hash text not null,
  revision integer not null,
  asana_story_gid text not null,
  asana_task_gid text not null,
  posted_at timestamptz not null default now(),
  unique (entry_id, content_hash)
);
revoke all on mops.dev_log_comments from public, anon, authenticated;
grant all on mops.dev_log_comments to service_role;
comment on column mops.dev_log_entries.asana_subtask_gid is 'DEPRECATED: legacy per-day subtask sync; comments ledger is mops.dev_log_comments';
comment on table mops.dev_log_days is 'DEPRECATED: legacy daily parent tasks; Development Log now posts comments to one permanent Asana task';

create or replace function public.mops_devlog_internal(_op text, _args jsonb)
returns jsonb language plpgsql security definer set search_path = public, mops as $$
declare
  res jsonb;
  lease_rows integer;
  e mops.dev_log_entries;
  rev integer;
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
    select coalesce(jsonb_agg(to_jsonb(x) order by x.day, x.created_at), '[]'::jsonb) into res from (
      select en.*, (select count(*) from mops.dev_log_comments c where c.entry_id = en.id) as prior_comments,
        exists(select 1 from mops.dev_log_comments c where c.entry_id = en.id and c.content_hash = en.content_hash) as already_posted
      from mops.dev_log_entries en where en.synced_at is null order by en.day, en.created_at limit 25) x;
    return res;
  elsif _op = 'devlog_record_comment' then
    select * into e from mops.dev_log_entries where id = nullif(_args->>'id','')::uuid;
    if e.id is null then return jsonb_build_object('error','entry not found'); end if;
    select count(*) + 1 into rev from mops.dev_log_comments where entry_id = e.id;
    insert into mops.dev_log_comments (entry_id, change_id, content_hash, revision, asana_story_gid, asana_task_gid)
      values (e.id, e.change_id, _args->>'hash', rev, _args->>'story_gid', _args->>'task_gid')
      on conflict (entry_id, content_hash) do nothing;
    update mops.dev_log_entries set synced_at = now() where id = e.id and content_hash is not distinct from _args->>'hash';
    return jsonb_build_object('ok', true);
  elsif _op = 'devlog_mark_synced' then
    update mops.dev_log_entries set synced_at = now() where id = nullif(_args->>'id','')::uuid;
    return jsonb_build_object('ok', true);
  elsif _op = 'devlog_status' then
    select jsonb_build_object('sync', (select to_jsonb(s) from mops.dev_log_sync_state s where s.id),
      'pending', (select count(*) from mops.dev_log_entries where synced_at is null),
      'comments', (select count(*) from mops.dev_log_comments)) into res;
    return res;
  end if;
  return jsonb_build_object('error','unknown_op');
end $$;
revoke all on function public.mops_devlog_internal(text, jsonb) from public, anon, authenticated;
grant execute on function public.mops_devlog_internal(text, jsonb) to service_role;

-- Re-queue existing entries so they migrate as comments (legacy subtask gids are kept).
update mops.dev_log_entries set synced_at = null where id in (select id from mops.dev_log_entries where synced_at is not null);