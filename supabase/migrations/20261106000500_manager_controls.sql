-- Manager controls (DECISIONS.md D25):
--  * agency-written scenarios (any slug key), versioned like the built-in five, with archiving;
--  * per-rep scenario assignments (a rep with none sees every active scenario);
--  * the must-say checklist in evaluations is re-checked against the frozen transcript.
-- Say rules (must_say, never_say, objection_answers) live in the campaign pack JSON and need no
-- table change; the API validates them with Zod before save.

-- ---------------------------------------------------------------- scenarios: any key, archiving
alter table public.scenario_versions drop constraint scenario_versions_scenario_key_check;
alter table public.scenario_versions add constraint scenario_versions_scenario_key_check check (scenario_key ~ '^[a-z0-9][a-z0-9-]{1,39}$');
alter table public.scenario_versions add column archived boolean not null default false;
alter table public.scenario_versions add column created_by uuid references auth.users(id) on delete set null;
alter table public.scenario_versions add constraint scenario_versions_text_lengths check (
  length(title) between 1 and 80 and length(persona) between 1 and 80 and length(opener) between 1 and 300
  and length(objection) between 1 and 120 and length(goal) between 1 and 300 and length(allowed_ending) between 1 and 300
  and length(behaviour) between 1 and 400 and length(skill) between 1 and 60);

/**
 * Latest version of each scenario key in an agency (archived ones included).
 * SECURITY INVOKER: a signed-in caller only sees their own agency's rows (RLS), so passing another
 * agency's id returns nothing. app_api SECURITY DEFINER functions call it with the owner's rights.
 */
create or replace function app_private.latest_scenarios(p_agency uuid) returns setof public.scenario_versions
language sql stable security invoker set search_path = '' as $$
  select distinct on (s.scenario_key) s.* from public.scenario_versions s
  where s.agency_id = p_agency order by s.scenario_key, s.version desc
$$;

-- ---------------------------------------------------------------- per-rep assignments
create table public.scenario_assignments (
  agency_id uuid not null,
  user_id uuid not null,
  scenario_key text not null check (scenario_key ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (agency_id, user_id, scenario_key),
  foreign key (agency_id, user_id) references public.memberships(agency_id, user_id) on delete cascade
);
alter table public.scenario_assignments enable row level security;
revoke all on public.scenario_assignments from public, anon, authenticated;
grant select on public.scenario_assignments to authenticated;
create policy assignments_read on public.scenario_assignments for select to authenticated using (
  app_private.is_manager(agency_id) or (user_id = (select auth.uid()) and app_private.is_member(agency_id))
);

/** Scenario keys a rep may start: assigned ones if any are set, otherwise every active scenario. */
-- SECURITY INVOKER for the same reason as latest_scenarios (RLS limits callers to their own rows).
create or replace function app_private.rep_scenario_allowed(p_agency uuid, p_user uuid, p_key text) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from app_private.latest_scenarios(p_agency) s where s.scenario_key = p_key and not s.archived)
     and (not exists (select 1 from public.scenario_assignments a where a.agency_id = p_agency and a.user_id = p_user)
          or exists (select 1 from public.scenario_assignments a where a.agency_id = p_agency and a.user_id = p_user and a.scenario_key = p_key))
$$;

-- ---------------------------------------------------------------- manager functions
/** Creates a scenario (no key: made from the title) or a new version of an existing one. */
create or replace function app_api.save_scenario(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.memberships; cur public.scenario_versions; v_key text := nullif(p ->> 'key', ''); v_base text; v_n int := 1; v_version int;
begin
  m := app_private.require_manager();
  if v_key is null then
    v_base := left(trim(both '-' from regexp_replace(lower(coalesce(p ->> 'title', '')), '[^a-z0-9]+', '-', 'g')), 34);
    if length(v_base) < 2 then v_base := 'scenario'; end if;
    v_key := v_base;
    while exists (select 1 from public.scenario_versions s where s.agency_id = m.agency_id and s.scenario_key = v_key) loop
      v_n := v_n + 1; v_key := v_base || '-' || v_n;
    end loop;
  else
    select * into cur from app_private.latest_scenarios(m.agency_id) s where s.scenario_key = v_key;
    if not found then perform app_private.fail('not_found', 'Scenario not found.'); end if;
  end if;
  v_version := coalesce(cur.version, 0) + 1;
  begin
    insert into public.scenario_versions(agency_id, scenario_key, version, title, persona, opener, objection, goal, allowed_ending, behaviour, skill, archived, created_by)
      values (m.agency_id, v_key, v_version, btrim(p ->> 'title'), btrim(p ->> 'persona'), btrim(p ->> 'opener'), btrim(p ->> 'objection'), btrim(p ->> 'goal'),
              btrim(p ->> 'allowedEnding'), btrim(p ->> 'behaviour'), btrim(p ->> 'skill'), coalesce(cur.archived, false), m.user_id);
  exception
    when check_violation or not_null_violation then perform app_private.fail('invalid_scenario', 'Every scenario field needs text within its length limit.');
    when unique_violation then perform app_private.fail('conflict', 'This scenario changed at the same time. Reload and try again.');
  end;
  perform app_private.audit(m.agency_id, 'scenario_saved', 'scenario', v_key, jsonb_build_object('version', v_version));
  return jsonb_build_object('key', v_key, 'version', v_version);
end $$;

/** Archive or restore: a new version with the flag (versions are immutable). */
create or replace function app_api.set_scenario_archived(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.memberships; cur public.scenario_versions; v_archived boolean := (p ->> 'archived')::boolean;
begin
  m := app_private.require_manager();
  select * into cur from app_private.latest_scenarios(m.agency_id) s where s.scenario_key = p ->> 'key';
  if not found then perform app_private.fail('not_found', 'Scenario not found.'); end if;
  if v_archived is null then perform app_private.fail('invalid_input', 'Say whether to archive or restore.'); end if;
  if cur.archived = v_archived then return jsonb_build_object('key', cur.scenario_key, 'version', cur.version); end if;
  insert into public.scenario_versions(agency_id, scenario_key, version, title, persona, opener, objection, goal, allowed_ending, behaviour, skill, archived, created_by)
    values (m.agency_id, cur.scenario_key, cur.version + 1, cur.title, cur.persona, cur.opener, cur.objection, cur.goal, cur.allowed_ending, cur.behaviour, cur.skill, v_archived, m.user_id);
  if v_archived then delete from public.scenario_assignments where agency_id = m.agency_id and scenario_key = cur.scenario_key; end if;
  perform app_private.audit(m.agency_id, case when v_archived then 'scenario_archived' else 'scenario_restored' end, 'scenario', cur.scenario_key);
  return jsonb_build_object('key', cur.scenario_key, 'version', cur.version + 1);
end $$;

/** Replaces a rep's assignments. Empty list = no restriction (every active scenario). */
create or replace function app_api.set_scenario_assignments(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.memberships; target public.memberships; v_keys text[]; k text;
begin
  m := app_private.require_manager();
  select * into target from public.memberships where agency_id = m.agency_id and user_id = (p ->> 'user_id')::uuid;
  if not found then perform app_private.fail('not_found', 'Member not found.'); end if;
  if target.role <> 'rep' then perform app_private.fail('invalid_input', 'Scenarios are assigned to reps.'); end if;
  if jsonb_typeof(p -> 'keys') <> 'array' or jsonb_array_length(p -> 'keys') > 50 then perform app_private.fail('invalid_input', 'Send a list of scenario keys.'); end if;
  select coalesce(array_agg(distinct x), '{}') into v_keys from jsonb_array_elements_text(p -> 'keys') x;
  foreach k in array v_keys loop
    if not exists (select 1 from app_private.latest_scenarios(m.agency_id) s where s.scenario_key = k and not s.archived) then
      perform app_private.fail('invalid_scenario', format('Unknown or archived scenario: %s', k));
    end if;
  end loop;
  delete from public.scenario_assignments where agency_id = m.agency_id and user_id = target.user_id;
  insert into public.scenario_assignments(agency_id, user_id, scenario_key, assigned_by)
    select m.agency_id, target.user_id, x, m.user_id from unnest(v_keys) x;
  perform app_private.audit(m.agency_id, 'scenarios_assigned', 'user', target.user_id::text, jsonb_build_object('keys', to_jsonb(v_keys)));
  return jsonb_build_object('keys', to_jsonb(v_keys));
end $$;

/** Every scenario (latest version, archived included) and every rep's assignments. */
create or replace function app_api.scenario_admin() returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare m public.memberships;
begin
  select * into m from public.memberships where user_id = (select auth.uid()) and active and role = 'manager';
  if not found then perform app_private.fail('forbidden', 'Manager access required.'); end if;
  return jsonb_build_object(
    'scenarios', coalesce((select jsonb_agg(jsonb_build_object('key', s.scenario_key, 'version', s.version, 'title', s.title, 'persona', s.persona,
                   'opener', s.opener, 'objection', s.objection, 'goal', s.goal, 'allowedEnding', s.allowed_ending, 'behaviour', s.behaviour,
                   'skill', s.skill, 'archived', s.archived) order by s.archived, s.title)
                 from app_private.latest_scenarios(m.agency_id) s), '[]'::jsonb),
    'assignments', coalesce((select jsonb_object_agg(x.user_id, x.keys) from (
                   select a.user_id, jsonb_agg(a.scenario_key order by a.scenario_key) keys from public.scenario_assignments a
                   where a.agency_id = m.agency_id group by a.user_id) x), '{}'::jsonb));
end $$;

-- ---------------------------------------------------------------- reps only see what they may start
create or replace function app_api.my_context() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'membership', (select jsonb_build_object('agencyId', m.agency_id, 'role', m.role, 'active', m.active) from public.memberships m where m.user_id = (select auth.uid())),
    'profile', (select jsonb_build_object('displayName', p.display_name) from public.profiles p where p.user_id = (select auth.uid())),
    'agency', (select jsonb_build_object('name', a.name, 'retentionDays', a.retention_days) from public.agencies a limit 1),
    'campaign', (select jsonb_build_object('version', c.version, 'pack', c.pack, 'rubricVersion', r.version)
                 from public.campaign_versions c join public.rubric_versions r on r.id = c.rubric_version_id
                 where c.state = 'published' order by c.version desc limit 1),
    'scenarios', coalesce((select jsonb_agg(x order by x ->> 'title') from (
                   select jsonb_build_object('key', s.scenario_key, 'version', s.version, 'title', s.title, 'persona', s.persona,
                     'opener', s.opener, 'objection', s.objection, 'goal', s.goal, 'allowedEnding', s.allowed_ending, 'behaviour', s.behaviour, 'skill', s.skill) x
                   from public.memberships me, app_private.latest_scenarios(me.agency_id) s
                   where me.user_id = (select auth.uid()) and me.active
                     and (me.role = 'manager' or app_private.rep_scenario_allowed(me.agency_id, me.user_id, s.scenario_key))
                     and not s.archived) q), '[]'::jsonb),
    'usage', (select jsonb_build_object('allowanceSeconds', u.allowance_seconds, 'consumedSeconds', u.consumed_seconds, 'reservedSeconds', u.reserved_seconds, 'periodEnd', u.ends_at)
              from public.usage_periods u where u.starts_at <= now() and u.ends_at > now() order by u.starts_at desc limit 1)
  )
$$;

-- start_session: a full session must use an active scenario the rep is allowed; drills (60-second
-- retries suggested by feedback) keep using the built-in drill scenarios.
create or replace function app_api.start_session(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.memberships; s public.sessions; per public.usage_periods; cv public.campaign_versions; sv public.scenario_versions;
  v_req text := p ->> 'request_id'; v_drill text := nullif(p ->> 'drill_key', ''); v_parent uuid := nullif(p ->> 'parent_session_id', '')::uuid;
  v_scenario text := p ->> 'scenario_key'; v_kind text; v_max int; v_turns int; v_opener text;
begin
  m := app_private.require_member();
  if m.role <> 'rep' then perform app_private.fail('forbidden', 'Only reps can start practice.'); end if;
  if v_req is null or length(v_req) not between 8 and 100 then perform app_private.fail('invalid_input', 'Missing idempotency key.'); end if;

  select * into s from public.sessions where agency_id = m.agency_id and rep_id = m.user_id and start_request_id = v_req;
  if found then return app_private.session_json(s.id); end if;

  if v_drill is not null then
    if app_private.drill_opener(v_drill) is null then perform app_private.fail('invalid_scenario', 'Unknown drill.'); end if;
    v_scenario := app_private.drill_scenario(v_drill);
  elsif not app_private.rep_scenario_allowed(m.agency_id, m.user_id, v_scenario) then
    perform app_private.fail('scenario_not_available', 'This scenario isn''t available to you. Choose one from your practice list.');
  end if;
  v_kind := case when v_drill is null then 'full' else 'drill' end;
  v_max := case when v_kind = 'full' then 180 else 60 end;
  v_turns := case when v_kind = 'full' then 12 else 5 end;

  if v_parent is not null and not exists (select 1 from public.sessions x where x.id = v_parent and x.agency_id = m.agency_id and x.rep_id = m.user_id) then
    perform app_private.fail('invalid_parent', 'Drill parent must be one of your sessions.');
  end if;

  perform app_private.close_session(x.id, case when exists (select 1 from public.turns t where t.session_id = x.id and t.speaker = 'rep') then 'time_limit' else 'abandoned' end)
    from public.sessions x where x.rep_id = m.user_id and x.status in ('created', 'active', 'ending')
      and coalesce(x.deadline_at, x.created_at + interval '2 minutes') < now();
  if exists (select 1 from public.sessions x where x.rep_id = m.user_id and x.status in ('created', 'active', 'ending')) then
    perform app_private.fail('session_in_progress', 'Finish or end your current practice first.');
  end if;

  select * into cv from public.campaign_versions where agency_id = m.agency_id and state = 'published' order by version desc limit 1;
  if not found then perform app_private.fail('no_published_campaign', 'Your agency has not published a campaign yet.'); end if;
  select * into sv from app_private.latest_scenarios(m.agency_id) x where x.scenario_key = v_scenario;
  if not found then perform app_private.fail('invalid_scenario', 'Unknown scenario.'); end if;
  v_opener := coalesce(app_private.drill_opener(v_drill), sv.opener);

  select * into per from public.usage_periods where agency_id = m.agency_id and starts_at <= now() and ends_at > now()
   order by starts_at desc limit 1 for update;
  if not found then perform app_private.fail('no_usage_period', 'No practice allowance is set up for this period. Ask your manager.'); end if;
  if per.allowance_seconds - per.consumed_seconds - per.reserved_seconds < v_max then
    perform app_private.fail('allowance_exhausted', format('Not enough practice allowance left: a %s needs %s seconds reserved.', case when v_kind = 'full' then 'session' else 'drill' end, v_max));
  end if;

  begin
    insert into public.sessions(agency_id, rep_id, kind, scenario_version_id, drill_key, campaign_version_id, rubric_version_id, parent_session_id,
                                usage_period_id, max_seconds, max_rep_turns, start_request_id)
    values (m.agency_id, m.user_id, v_kind, sv.id, v_drill, cv.id, cv.rubric_version_id, v_parent, per.id, v_max, v_turns, v_req)
    returning * into s;
  exception when unique_violation then
    select * into s from public.sessions where agency_id = m.agency_id and rep_id = m.user_id and start_request_id = v_req;
    if found then return app_private.session_json(s.id); end if;
    perform app_private.fail('session_in_progress', 'Finish or end your current practice first.');
  end;
  update public.usage_periods set reserved_seconds = reserved_seconds + v_max where id = per.id;
  insert into public.usage_ledger(agency_id, period_id, session_id, operation_id, kind, seconds)
    values (m.agency_id, per.id, s.id, 'reserve:' || s.id, 'reservation', v_max);
  insert into public.turns(agency_id, session_id, sequence, label, speaker, text, source) values (m.agency_id, s.id, 1, 'resident-1', 'resident', v_opener, 'scripted');
  return app_private.session_json(s.id);
end $$;

-- ---------------------------------------------------------------- evidence re-check covers the must-say checklist
create or replace function app_private.evidence_problems(p_session uuid, p_revision int, r jsonb) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare problems text[] := '{}'; ev jsonb; v_text text; rs jsonb; v_must text[]; v_ids text[];
begin
  for ev in
    select e from jsonb_array_elements(coalesce(r -> 'dimensions', '[]')) d, jsonb_array_elements(coalesce(d -> 'evidence', '[]')) e
    union all
    select e from jsonb_array_elements(coalesce(r -> 'concerns', '[]')) c, jsonb_array_elements(coalesce(c -> 'evidence', '[]')) e
    union all
    select e from jsonb_array_elements(coalesce(r -> 'required_statements', '[]')) q, jsonb_array_elements(coalesce(q -> 'evidence', '[]')) e
  loop
    select t.text into v_text from app_private.transcript_at(p_session, p_revision) t where t.label = ev ->> 'turn_id';
    if v_text is null then problems := problems || format('unknown turn %s', ev ->> 'turn_id');
    elsif coalesce(ev ->> 'quote', '') = '' or strpos(v_text, ev ->> 'quote') = 0 then problems := problems || format('quote not found in %s', ev ->> 'turn_id');
    end if;
  end loop;
  -- A statement marked "said" needs a rep quote; "not said" has none.
  for rs in select q from jsonb_array_elements(coalesce(r -> 'required_statements', '[]')) q loop
    if (rs ->> 'said')::boolean and not exists (select 1 from jsonb_array_elements(coalesce(rs -> 'evidence', '[]')) e where e ->> 'turn_id' like 'rep-%') then
      problems := problems || format('required statement %s marked said without rep evidence', rs ->> 'id');
    elsif not (rs ->> 'said')::boolean and jsonb_array_length(coalesce(rs -> 'evidence', '[]')) > 0 then
      problems := problems || format('required statement %s marked not said but has evidence', rs ->> 'id');
    end if;
  end loop;
  -- The checklist must cover the session's frozen must-say items exactly.
  select coalesce(array_agg(x ->> 'id' order by x ->> 'id'), '{}') into v_must
    from public.sessions s join public.campaign_versions c on c.id = s.campaign_version_id, jsonb_array_elements(coalesce(c.pack -> 'must_say', '[]')) x
   where s.id = p_session;
  select coalesce(array_agg(q ->> 'id' order by q ->> 'id'), '{}') into v_ids from jsonb_array_elements(coalesce(r -> 'required_statements', '[]')) q;
  if v_must is distinct from v_ids then problems := problems || 'required_statements must cover each must-say item once'::text; end if;
  if (select count(distinct d ->> 'key') from jsonb_array_elements(coalesce(r -> 'dimensions', '[]')) d) <> 5 then problems := problems || 'dimensions must be the five keys once each'::text; end if;
  if (r ->> 'transcript_revision')::int is distinct from p_revision then problems := problems || 'transcript_revision mismatch'::text; end if;
  return problems;
end $$;

-- ---------------------------------------------------------------- scenario titles on sessions (custom scenarios aren't in app code)
create or replace function app_private.session_json(p_session uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id, 'repId', s.rep_id, 'repName', coalesce(pr.display_name, 'Rep'), 'kind', s.kind,
    'scenarioKey', sv.scenario_key, 'scenarioTitle', sv.title, 'drillKey', s.drill_key, 'parentSessionId', s.parent_session_id,
    'campaignVersion', cv.version, 'campaignName', cv.pack ->> 'name', 'rubricVersion', rv.version, 'mode', s.mode,
    'status', s.status, 'evaluationStatus', s.evaluation_status, 'startedAt', s.started_at, 'deadlineAt', s.deadline_at,
    'endedAt', s.ended_at, 'endReason', s.end_reason, 'transcriptRevision', s.transcript_revision, 'usedSeconds', s.used_seconds,
    'serverNow', now(),
    'turns', coalesce((select jsonb_agg(jsonb_build_object('id', t.label, 'sequence', t.sequence, 'speaker', t.speaker, 'text', t.text, 'source', t.source, 'createdAt', t.created_at) order by t.sequence)
                       from public.turns t where t.session_id = s.id), '[]'::jsonb),
    'corrections', coalesce((select jsonb_agg(jsonb_build_object('turnId', c.turn_label, 'revision', c.revision, 'correctedText', c.corrected_text, 'note', c.note,
                                   'correctedBy', coalesce((select p2.display_name from public.profiles p2 where p2.user_id = c.corrected_by), 'Manager'), 'createdAt', c.created_at) order by c.revision)
                       from public.turn_corrections c where c.session_id = s.id), '[]'::jsonb),
    'evaluations', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'transcriptRevision', e.transcript_revision, 'evaluatorKind', e.evaluator_kind, 'model', e.model,
                                   'promptVersion', e.prompt_version, 'status', e.status, 'result', e.result, 'createdAt', e.created_at) order by e.created_at)
                       from public.evaluations e where e.session_id = s.id), '[]'::jsonb)
  )
  from public.sessions s
  join public.scenario_versions sv on sv.id = s.scenario_version_id
  join public.campaign_versions cv on cv.id = s.campaign_version_id
  join public.rubric_versions rv on rv.id = s.rubric_version_id
  left join public.profiles pr on pr.user_id = s.rep_id
  where s.id = p_session
$$;

create or replace function app_api.manager_summaries() returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare m public.memberships;
begin
  select * into m from public.memberships where user_id = (select auth.uid()) and active and role = 'manager';
  if not found then perform app_private.fail('forbidden', 'Manager access required.'); end if;
  return jsonb_build_object(
    'activeRepIds', coalesce((select jsonb_agg(x.user_id) from public.memberships x where x.agency_id = m.agency_id and x.role = 'rep' and x.active), '[]'::jsonb),
    'currentRubricVersion', (select r.version from public.campaign_versions c join public.rubric_versions r on r.id = c.rubric_version_id
                             where c.agency_id = m.agency_id and c.state = 'published' order by c.version desc limit 1),
    'usage', (select jsonb_build_object('allowanceSeconds', u.allowance_seconds, 'consumedSeconds', u.consumed_seconds, 'reservedSeconds', u.reserved_seconds)
              from public.usage_periods u where u.agency_id = m.agency_id and u.starts_at <= now() and u.ends_at > now() order by u.starts_at desc limit 1),
    'sessions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'repId', s.rep_id, 'repName', coalesce(pr.display_name, 'Rep'), 'scenarioKey', sv.scenario_key, 'scenarioTitle', sv.title, 'drillKey', s.drill_key,
        'status', s.status, 'evaluationStatus', s.evaluation_status, 'endedAt', s.ended_at, 'usedSeconds', s.used_seconds, 'rubricVersion', rv.version,
        'scores', (select jsonb_object_agg(d ->> 'key', d -> 'score') from jsonb_array_elements(e.result -> 'dimensions') d),
        'openConcerns', case when exists (select 1 from public.manager_reviews mr where mr.session_id = s.id and mr.resolution = 'resolved') then 0
                             else coalesce(jsonb_array_length(e.result -> 'concerns'), 0) end,
        'openReports', (select count(*) from public.feedback_reports fr where fr.session_id = s.id and fr.status = 'open')
      ) order by s.ended_at desc nulls last)
      from public.sessions s
      join public.scenario_versions sv on sv.id = s.scenario_version_id
      join public.rubric_versions rv on rv.id = s.rubric_version_id
      left join public.profiles pr on pr.user_id = s.rep_id
      left join lateral (select ev.result from public.evaluations ev where ev.session_id = s.id and ev.status = 'completed' order by ev.transcript_revision desc limit 1) e on true
      where s.agency_id = m.agency_id), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function app_private.latest_scenarios(uuid), app_private.rep_scenario_allowed(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function app_private.latest_scenarios(uuid), app_private.rep_scenario_allowed(uuid, uuid, text) to authenticated, service_role;
revoke all on function app_api.save_scenario(jsonb), app_api.set_scenario_archived(jsonb), app_api.set_scenario_assignments(jsonb), app_api.scenario_admin()
  from public, anon, authenticated, service_role;
grant execute on function app_api.save_scenario(jsonb), app_api.set_scenario_archived(jsonb), app_api.set_scenario_assignments(jsonb), app_api.scenario_admin()
  to authenticated;
grant execute on function app_api.my_context(), app_api.start_session(jsonb), app_api.manager_summaries() to authenticated;
grant execute on function app_private.session_json(uuid) to authenticated, service_role;
