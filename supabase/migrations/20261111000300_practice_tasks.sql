-- Practice tasks (DECISIONS D44): a manager asks reps to practise a scenario a number of times,
-- optionally by a date. Progress counts the rep's finished full sessions on that scenario since the
-- task was set. Reps see their own tasks; managers see their team's. Reminder emails are handed to
-- the server once per rep per task, the day before it's due.
-- Backwards compatible: new tables and functions only.

create table if not exists public.practice_tasks (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  scenario_key text not null check (length(scenario_key) between 1 and 80),
  note text check (note is null or length(note) <= 300),
  target_count int not null check (target_count between 1 and 20),
  due_at timestamptz,
  rep_ids uuid[], -- null: every active rep, now and later
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists practice_tasks_agency on public.practice_tasks(agency_id) where archived_at is null;
alter table public.practice_tasks enable row level security;
revoke all on public.practice_tasks from anon, authenticated;

create table if not exists public.practice_task_reminders (
  task_id uuid not null references public.practice_tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
alter table public.practice_task_reminders enable row level security;
revoke all on public.practice_task_reminders from anon, authenticated;

/** Finished full sessions by this rep on the task's scenario since the task was set. */
create or replace function app_private.task_done(t public.practice_tasks, p_user uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.sessions s join public.scenario_versions sv on sv.id = s.scenario_version_id
   where s.agency_id = t.agency_id and s.rep_id = p_user and s.kind = 'full' and s.status = 'ended'
     and sv.scenario_key = t.scenario_key and s.ended_at >= t.created_at
$$;

create or replace function app_private.task_json(t public.practice_tasks, p_only uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', t.id, 'scenarioKey', t.scenario_key,
    'scenarioTitle', coalesce((select sv.title from app_private.latest_scenarios(t.agency_id) sv where sv.scenario_key = t.scenario_key), t.scenario_key),
    'note', t.note, 'target', t.target_count, 'dueAt', t.due_at, 'createdAt', t.created_at, 'archived', t.archived_at is not null,
    'everyone', t.rep_ids is null,
    'createdBy', coalesce((select pr.display_name from public.profiles pr where pr.user_id = t.created_by), 'Your manager'),
    'assignees', coalesce((select jsonb_agg(jsonb_build_object('userId', m.user_id, 'name', coalesce(pr.display_name, 'Rep'),
                    'done', least(app_private.task_done(t, m.user_id), t.target_count),
                    'canPractise', app_private.rep_scenario_allowed(t.agency_id, m.user_id, t.scenario_key)) order by lower(coalesce(pr.display_name, '')))
                  from public.memberships m left join public.profiles pr on pr.user_id = m.user_id
                  where m.agency_id = t.agency_id and m.role = 'rep' and m.active
                    and (t.rep_ids is null or m.user_id = any(t.rep_ids))
                    and (p_only is null or m.user_id = p_only)), '[]'::jsonb)
  )
$$;

/** Managers: their team's tasks (newest first). Reps: tasks set for them. */
create or replace function app_api.list_tasks(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.memberships;
begin
  m := app_private.require_member();
  if m.role = 'manager' then
    return coalesce((select jsonb_agg(app_private.task_json(t, null) order by t.archived_at nulls first, t.created_at desc)
      from public.practice_tasks t where t.agency_id = m.agency_id
        and (t.archived_at is null or (coalesce((p ->> 'include_archived')::boolean, false) and t.archived_at > now() - interval '60 days'))), '[]'::jsonb);
  end if;
  return coalesce((select jsonb_agg(app_private.task_json(t, m.user_id) order by t.due_at nulls last, t.created_at desc)
    from public.practice_tasks t where t.agency_id = m.agency_id and t.archived_at is null
      and (t.rep_ids is null or m.user_id = any(t.rep_ids))), '[]'::jsonb);
end $$;

create or replace function app_api.create_task(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.memberships; t public.practice_tasks; v_key text := p ->> 'scenario_key'; v_reps uuid[]; v_due timestamptz := nullif(p ->> 'due_at', '')::timestamptz;
        v_target int := coalesce((p ->> 'target_count')::int, 1);
begin
  m := app_private.require_manager();
  if not exists (select 1 from app_private.latest_scenarios(m.agency_id) s where s.scenario_key = v_key and not s.archived) then
    perform app_private.fail('invalid_input', 'Choose one of your team''s scenarios.');
  end if;
  if v_target not between 1 and 20 then perform app_private.fail('invalid_input', 'Ask for between 1 and 20 sessions.'); end if;
  if v_due is not null and v_due < now() then perform app_private.fail('invalid_input', 'The due date has already passed.'); end if;
  if length(coalesce(p ->> 'note', '')) > 300 then perform app_private.fail('invalid_input', 'Keep the note under 300 characters.'); end if;
  if jsonb_typeof(p -> 'rep_ids') = 'array' then
    select array_agg(x::uuid) into v_reps from jsonb_array_elements_text(p -> 'rep_ids') x;
    if v_reps is null or cardinality(v_reps) = 0 then perform app_private.fail('invalid_input', 'Choose at least one rep.'); end if;
    if exists (select 1 from unnest(v_reps) r where not exists (select 1 from public.memberships mm where mm.user_id = r and mm.agency_id = m.agency_id and mm.role = 'rep' and mm.active)) then
      perform app_private.fail('invalid_input', 'Some of those people aren''t active reps in your team.');
    end if;
  end if;
  insert into public.practice_tasks(agency_id, created_by, scenario_key, note, target_count, due_at, rep_ids)
    values (m.agency_id, m.user_id, v_key, nullif(btrim(p ->> 'note'), ''), v_target, v_due, v_reps) returning * into t;
  perform app_private.audit(m.agency_id, 'task_created', 'practice_task', t.id::text, jsonb_build_object('scenario_key', v_key, 'target', v_target, 'due_at', v_due));
  return app_private.task_json(t, null);
end $$;

create or replace function app_api.archive_task(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.memberships;
begin
  m := app_private.require_manager();
  update public.practice_tasks set archived_at = coalesce(archived_at, now()) where id = (p ->> 'task_id')::uuid and agency_id = m.agency_id;
  if not found then perform app_private.fail('not_found', 'Task not found.'); end if;
  perform app_private.audit(m.agency_id, 'task_archived', 'practice_task', p ->> 'task_id');
  return jsonb_build_object('ok', true);
end $$;

/** Server only: reps with an unfinished task due within the next day who haven't been reminded. */
create or replace function app_api.claim_task_reminders(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_out jsonb;
begin
  with due as (
    select t.id as task_id, m.user_id, u.email, coalesce(pr.display_name, 'there') as name, a.name as team,
           coalesce((select sv.title from app_private.latest_scenarios(t.agency_id) sv where sv.scenario_key = t.scenario_key), t.scenario_key) as scenario,
           t.target_count, app_private.task_done(t, m.user_id) as done, t.due_at, t.note
      from public.practice_tasks t
      join public.agencies a on a.id = t.agency_id and a.status = 'active'
      join public.memberships m on m.agency_id = t.agency_id and m.role = 'rep' and m.active and (t.rep_ids is null or m.user_id = any(t.rep_ids))
      join auth.users u on u.id = m.user_id and u.email_confirmed_at is not null
      left join public.profiles pr on pr.user_id = m.user_id
     where t.archived_at is null and t.due_at > now() and t.due_at <= now() + interval '24 hours'
       and not exists (select 1 from public.practice_task_reminders r where r.task_id = t.id and r.user_id = m.user_id)
  ), todo as (select * from due where done < target_count limit 200),
  ins as (insert into public.practice_task_reminders(task_id, user_id) select task_id, user_id from todo on conflict do nothing returning 1)
  select coalesce(jsonb_agg(jsonb_build_object('email', email, 'name', name, 'team', team, 'scenario', scenario, 'target', target_count,
           'done', done, 'dueAt', due_at, 'note', note)), '[]'::jsonb) into v_out from todo;
  return v_out;
end $$;

revoke all on function app_private.task_done(public.practice_tasks, uuid), app_private.task_json(public.practice_tasks, uuid) from public, anon, authenticated, service_role;
revoke all on function app_api.list_tasks(jsonb), app_api.create_task(jsonb), app_api.archive_task(jsonb), app_api.claim_task_reminders(jsonb) from public, anon, authenticated, service_role;
grant execute on function app_api.list_tasks(jsonb), app_api.create_task(jsonb), app_api.archive_task(jsonb) to authenticated;
grant execute on function app_api.claim_task_reminders(jsonb) to service_role;
