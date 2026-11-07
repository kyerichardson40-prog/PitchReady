-- app_api: the only write path. Functions derive identity from auth.uid() (JWT verified by
-- PostgREST), re-check active membership and role, and never trust client-supplied tenant IDs.
-- Service-only functions (granted to service_role) are called by trusted server code with the
-- Supabase secret key: resident turns, evaluation persistence, provider spend, maintenance.

-- ================================================================ helpers
create or replace function app_private.fail(p_code text, p_message text default null) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception '%', p_code using errcode = 'P0001', detail = coalesce(p_message, p_code);
end $$;

create or replace function app_private.drill_opener(p_key text) returns text
language sql immutable set search_path = '' as $$
  -- Must match lib/content/scenarios.ts (checked by tests/unit/sql-content.test.ts).
  select case p_key
    when 'already-donate' then 'I already give to a couple of charities, to be honest.'
    when 'busy' then 'I''m in a real rush, sorry.'
    when 'not-interested' then 'I''m not interested, thanks.'
    when 'cannot-afford' then 'Money''s tight at the moment, I can''t afford anything extra.'
    when 'prefers-one-off' then 'I only really do one-off donations.'
    when 'legitimacy' then 'Have you got any ID or a registration number?'
    when 'amount' then 'How much are you actually asking for?'
    when 'money-use' then 'Where does the money actually go?'
    when 'cancellation' then 'And how would I cancel if I changed my mind?'
    when 'asks-to-end' then 'I''d like you to go now, please.'
  end
$$;

create or replace function app_private.drill_scenario(p_key text) returns text
language sql immutable set search_path = '' as $$
  select case p_key
    when 'already-donate' then 'existing-donor' when 'busy' then 'busy' when 'not-interested' then 'firm-refusal'
    when 'cannot-afford' then 'existing-donor' when 'prefers-one-off' then 'monthly-giving' when 'legitimacy' then 'sceptical'
    when 'amount' then 'monthly-giving' when 'money-use' then 'sceptical' when 'cancellation' then 'monthly-giving'
    when 'asks-to-end' then 'firm-refusal' end
$$;

/** Active membership of the caller, or failure. */
create or replace function app_private.require_member() returns public.memberships
language plpgsql stable security definer set search_path = '' as $$
declare m public.memberships;
begin
  if auth.uid() is null then perform app_private.fail('unauthenticated', 'Sign in first.'); end if;
  select mm.* into m from public.memberships mm join public.agencies a on a.id = mm.agency_id
   where mm.user_id = auth.uid() and mm.active and a.status = 'active';
  if not found then perform app_private.fail('membership_inactive', 'Your membership is not active.'); end if;
  return m;
end $$;

create or replace function app_private.require_manager() returns public.memberships
language plpgsql stable security definer set search_path = '' as $$
declare m public.memberships;
begin
  m := app_private.require_member();
  if m.role <> 'manager' then perform app_private.fail('forbidden', 'Manager access required.'); end if;
  return m;
end $$;

create or replace function app_private.audit(p_agency uuid, p_action text, p_target_type text, p_target_id text, p_meta jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_events(agency_id, actor_id, action, target_type, target_id, metadata)
  values (p_agency, auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_meta, '{}'::jsonb));
$$;

/** Transcript at a revision: original immutable turns with the latest correction <= revision applied. */
create or replace function app_private.transcript_at(p_session uuid, p_revision int)
returns table(label text, speaker text, text text, seq int, corrected boolean)
language sql stable security invoker set search_path = '' as $$
  select t.label, t.speaker, coalesce(c.corrected_text, t.text), t.sequence, c.corrected_text is not null
  from public.turns t
  left join lateral (
    select tc.corrected_text from public.turn_corrections tc
    where tc.session_id = t.session_id and tc.turn_label = t.label and tc.revision <= p_revision
    order by tc.revision desc limit 1
  ) c on true
  where t.session_id = p_session
  order by t.sequence
$$;

/** Session payload shaped like lib/domain/types.ts PracticeSession. INVOKER: RLS applies to callers. */
create or replace function app_private.session_json(p_session uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id, 'repId', s.rep_id, 'repName', coalesce(pr.display_name, 'Rep'), 'kind', s.kind,
    'scenarioKey', sv.scenario_key, 'drillKey', s.drill_key, 'parentSessionId', s.parent_session_id,
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

/**
 * Closes an open session exactly once (caller must hold the row lock) and settles usage:
 * usable sessions are charged capped server elapsed time; provider failures and empty abandoned
 * sessions are refunded. Provider cost records are never touched here.
 */
create or replace function app_private.close_session(p_session uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions; v_end timestamptz; v_used int; v_status text; v_reason text; v_has_rep boolean; v_refund boolean;
begin
  select * into s from public.sessions where id = p_session for update;
  if not found or s.status not in ('created', 'active', 'ending') then return; end if;
  v_end := least(now(), coalesce(s.deadline_at, now()));
  v_has_rep := exists (select 1 from public.turns t where t.session_id = s.id and t.speaker = 'rep');
  v_reason := case when s.deadline_at is not null and now() >= s.deadline_at and p_reason in ('rep_ended', 'resident_ended', 'turn_limit') then 'time_limit' else p_reason end;
  v_refund := v_reason = 'provider_failure' or (v_reason = 'abandoned' and not v_has_rep) or s.started_at is null;
  v_status := case when v_reason = 'provider_failure' then 'failed'
                   when s.started_at is null then 'abandoned' -- never activated: nothing to charge or evaluate
                   when v_reason = 'abandoned' and not v_has_rep then 'abandoned'
                   else 'ended' end;
  v_used := case when v_refund or s.started_at is null then 0
                 else least(s.max_seconds, greatest(0, ceil(extract(epoch from (v_end - s.started_at)))))::int end;

  update public.usage_periods set reserved_seconds = reserved_seconds - s.max_seconds, consumed_seconds = consumed_seconds + v_used
   where id = s.usage_period_id;
  insert into public.usage_ledger(agency_id, period_id, session_id, operation_id, kind, seconds) values
    (s.agency_id, s.usage_period_id, s.id, 'settle:' || s.id, 'settlement', v_used),
    (s.agency_id, s.usage_period_id, s.id, case when v_refund then 'refund:' else 'release:' end || s.id, case when v_refund then 'refund' else 'release' end, s.max_seconds - v_used);

  update public.sessions set
    status = v_status, end_reason = v_reason, ended_at = case when s.started_at is null then now() else v_end end,
    used_seconds = v_used, turn_lock = null, turn_lock_at = null,
    evaluation_status = case when v_status = 'ended' then 'pending' else 'none' end
  where id = s.id;

  if v_status = 'ended' then
    insert into public.evaluation_jobs(agency_id, session_id, transcript_revision) values (s.agency_id, s.id, s.transcript_revision)
    on conflict do nothing;
  end if;
end $$;

-- ================================================================ rep operations
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
  end if;
  v_kind := case when v_drill is null then 'full' else 'drill' end;
  v_max := case when v_kind = 'full' then 180 else 60 end;
  v_turns := case when v_kind = 'full' then 12 else 5 end;

  if v_parent is not null and not exists (select 1 from public.sessions x where x.id = v_parent and x.agency_id = m.agency_id and x.rep_id = m.user_id) then
    perform app_private.fail('invalid_parent', 'Drill parent must be one of your sessions.');
  end if;

  -- Recover this rep's own expired open sessions so a stale one cannot block practice.
  perform app_private.close_session(x.id, case when exists (select 1 from public.turns t where t.session_id = x.id and t.speaker = 'rep') then 'time_limit' else 'abandoned' end)
    from public.sessions x where x.rep_id = m.user_id and x.status in ('created', 'active', 'ending')
      and coalesce(x.deadline_at, x.created_at + interval '2 minutes') < now();
  if exists (select 1 from public.sessions x where x.rep_id = m.user_id and x.status in ('created', 'active', 'ending')) then
    perform app_private.fail('session_in_progress', 'Finish or end your current practice first.');
  end if;

  select * into cv from public.campaign_versions where agency_id = m.agency_id and state = 'published' order by version desc limit 1;
  if not found then perform app_private.fail('no_published_campaign', 'Your agency has not published a campaign yet.'); end if;
  select * into sv from public.scenario_versions where agency_id = m.agency_id and scenario_key = v_scenario order by version desc limit 1;
  if not found then perform app_private.fail('invalid_scenario', 'Unknown scenario.'); end if;
  v_opener := coalesce(app_private.drill_opener(v_drill), sv.opener);

  -- Row lock serialises concurrent starts in the agency so allowance cannot be over-reserved.
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

/** Starts the server clock once the opening resident turn (and optional audio) is ready. */
create or replace function app_api.activate_session(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.memberships; s public.sessions;
begin
  m := app_private.require_member();
  select * into s from public.sessions where id = (p ->> 'session_id')::uuid and agency_id = m.agency_id and rep_id = m.user_id for update;
  if not found then perform app_private.fail('not_found', 'Session not found.'); end if;
  if s.status = 'created' then
    update public.sessions set status = 'active', started_at = now(), deadline_at = now() + make_interval(secs => s.max_seconds) where id = s.id;
  end if;
  return app_private.session_json(s.id);
end $$;

/** Shared checks for a rep turn; returns the locked session. */
create or replace function app_private.lock_turn_session(p jsonb, m public.memberships) returns public.sessions
language plpgsql security definer set search_path = '' as $$
declare s public.sessions; v_next int; v_reps int;
begin
  select * into s from public.sessions where id = (p ->> 'session_id')::uuid and agency_id = m.agency_id and rep_id = m.user_id for update;
  if not found then perform app_private.fail('not_found', 'Session not found.'); end if;
  if s.status <> 'active' then perform app_private.fail('session_closed', 'This practice has ended.'); end if;
  if s.turn_lock is not null and s.turn_lock <> (p ->> 'request_id') and s.turn_lock_at > now() - interval '90 seconds' then
    perform app_private.fail('turn_in_progress', 'Your previous reply is still being processed.');
  end if;
  select coalesce(max(sequence), 0) + 1, count(*) filter (where speaker = 'rep') into v_next, v_reps from public.turns where session_id = s.id;
  if (p ->> 'expected_sequence')::int is distinct from v_next then
    perform app_private.fail('stale_sequence', 'This turn is out of date. The transcript has been refreshed.');
  end if;
  if v_reps >= s.max_rep_turns then perform app_private.fail('turn_limit', 'You have used all replies for this practice.'); end if;
  return s;
end $$;

create or replace function app_private.deadline_passed(s public.sessions) returns boolean
language sql stable set search_path = '' as $$ select s.deadline_at is not null and now() >= s.deadline_at $$;

/** Reserve the single in-flight turn slot before slow work (speech-to-text). Idempotent. */
create or replace function app_api.begin_turn(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.memberships; s public.sessions; v_req text := p ->> 'request_id';
begin
  m := app_private.require_member();
  if exists (select 1 from public.turns t join public.sessions x on x.id = t.session_id
             where t.session_id = (p ->> 'session_id')::uuid and t.request_id = v_req and x.rep_id = m.user_id) then
    return jsonb_build_object('ok', true, 'duplicate', true, 'session', app_private.session_json((p ->> 'session_id')::uuid));
  end if;
  select * into s from public.sessions where id = (p ->> 'session_id')::uuid and agency_id = m.agency_id and rep_id = m.user_id;
  if found and s.status = 'active' and app_private.deadline_passed(s) then
    perform app_private.close_session(s.id, 'time_limit');
    return jsonb_build_object('ok', false, 'code', 'deadline_passed', 'session', app_private.session_json(s.id));
  end if;
  s := app_private.lock_turn_session(p, m);
  update public.sessions set turn_lock = v_req, turn_lock_at = now() where id = s.id;
  return jsonb_build_object('ok', true, 'duplicate', false);
end $$;

create or replace function app_api.commit_rep_turn(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.memberships; s public.sessions; v_req text := p ->> 'request_id'; v_text text := btrim(p ->> 'text'); v_n int; v_seq int;
begin
  m := app_private.require_member();
  if v_req is null or length(v_req) not between 8 and 100 then perform app_private.fail('invalid_input', 'Missing idempotency key.'); end if;
  if exists (select 1 from public.turns t join public.sessions x on x.id = t.session_id
             where t.session_id = (p ->> 'session_id')::uuid and t.request_id = v_req and x.rep_id = m.user_id) then
    return jsonb_build_object('ok', true, 'duplicate', true, 'session', app_private.session_json((p ->> 'session_id')::uuid));
  end if;
  select * into s from public.sessions where id = (p ->> 'session_id')::uuid and agency_id = m.agency_id and rep_id = m.user_id;
  if found and s.status = 'active' and app_private.deadline_passed(s) then
    perform app_private.close_session(s.id, 'time_limit');
    return jsonb_build_object('ok', false, 'code', 'deadline_passed', 'session', app_private.session_json(s.id));
  end if;
  s := app_private.lock_turn_session(p, m);
  if v_text is null or v_text = '' or length(v_text) > 1200 then perform app_private.fail('invalid_input', 'Reply must be 1–1200 characters.'); end if;
  if coalesce(p ->> 'source', 'typed') not in ('typed', 'transcribed') then perform app_private.fail('invalid_input', 'Bad source.'); end if;
  select count(*) filter (where speaker = 'rep') + 1, max(sequence) + 1 into v_n, v_seq from public.turns where session_id = s.id;
  insert into public.turns(agency_id, session_id, sequence, label, speaker, text, source, request_id)
    values (s.agency_id, s.id, v_seq, 'rep-' || v_n, 'rep', v_text, coalesce(p ->> 'source', 'typed'), v_req);
  -- Keep the slot locked until the resident reply is stored, so a second turn cannot interleave.
  update public.sessions set turn_lock = v_req, turn_lock_at = now() where id = s.id;
  return jsonb_build_object('ok', true, 'duplicate', false, 'session', app_private.session_json(s.id));
end $$;

create or replace function app_api.end_session(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.memberships; s public.sessions;
begin
  m := app_private.require_member();
  select * into s from public.sessions where id = (p ->> 'session_id')::uuid and agency_id = m.agency_id and rep_id = m.user_id for update;
  if not found then perform app_private.fail('not_found', 'Session not found.'); end if;
  perform app_private.close_session(s.id, 'rep_ended');
  return app_private.session_json(s.id);
end $$;

create or replace function app_api.report_feedback(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.memberships; s public.sessions; v_id uuid;
begin
  m := app_private.require_member();
  select * into s from public.sessions where id = (p ->> 'session_id')::uuid and agency_id = m.agency_id and rep_id = m.user_id;
  if not found then perform app_private.fail('not_found', 'Session not found.'); end if;
  insert into public.feedback_reports(agency_id, session_id, reporter_id, reason, description, turn_label)
    values (s.agency_id, s.id, m.user_id, p ->> 'reason', left(p ->> 'description', 1000), nullif(p ->> 'turn_label', ''))
    returning id into v_id;
  perform app_private.audit(s.agency_id, 'feedback_reported', 'session', s.id::text, jsonb_build_object('reason', p ->> 'reason'));
  return jsonb_build_object('id', v_id);
end $$;

create or replace function app_api.request_evaluation(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.memberships; s public.sessions; j public.evaluation_jobs;
begin
  m := app_private.require_member();
  select * into s from public.sessions where id = (p ->> 'session_id')::uuid and agency_id = m.agency_id
    and (rep_id = m.user_id or m.role = 'manager') for update;
  if not found then perform app_private.fail('not_found', 'Session not found.'); end if;
  if s.status <> 'ended' then perform app_private.fail('session_active', 'Feedback is available after the practice has ended.'); end if;
  if s.evaluation_status in ('completed', 'running') then return app_private.session_json(s.id); end if;
  select * into j from public.evaluation_jobs where session_id = s.id and transcript_revision = s.transcript_revision for update;
  if not found then
    insert into public.evaluation_jobs(agency_id, session_id, transcript_revision) values (s.agency_id, s.id, s.transcript_revision);
  elsif j.status = 'failed' then
    -- Controlled recovery: reps get a bounded number of retries; managers can always reset.
    if m.role <> 'manager' and j.attempts >= 6 then perform app_private.fail('retry_limit', 'Feedback retries are used up for this session. Your manager can retry it.'); end if;
    update public.evaluation_jobs set status = 'pending', lease_until = null, updated_at = now() where session_id = s.id and transcript_revision = s.transcript_revision;
  end if;
  update public.sessions set evaluation_status = 'pending' where id = s.id;
  return app_private.session_json(s.id);
end $$;

create or replace function app_api.request_deletion(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.memberships; v_id uuid;
begin
  m := app_private.require_member();
  insert into public.deletion_requests(agency_id, user_id, scope, note) values (m.agency_id, m.user_id, p ->> 'scope', nullif(left(p ->> 'note', 500), ''))
    returning id into v_id;
  perform app_private.audit(m.agency_id, 'deletion_requested', 'user', m.user_id::text, jsonb_build_object('scope', p ->> 'scope'));
  return jsonb_build_object('id', v_id);
end $$;

-- ================================================================ invitations
/** Service-only: describe an invitation for the landing page. Never returns the token or full email. */
create or replace function app_api.inspect_invitation(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare i public.invitations; v_agency text; v_user auth.users;
begin
  select * into i from public.invitations where token_hash = decode(p ->> 'token_hash', 'hex');
  if not found then return jsonb_build_object('status', 'invalid'); end if;
  select name into v_agency from public.agencies where id = i.agency_id;
  if i.revoked_at is not null then return jsonb_build_object('status', 'revoked'); end if;
  if i.used_at is not null then return jsonb_build_object('status', 'used'); end if;
  if i.expires_at <= now() then return jsonb_build_object('status', 'expired'); end if;
  if nullif(p ->> 'user_id', '') is null then
    return jsonb_build_object('status', 'sign_in_required', 'role', i.role, 'agencyName', v_agency);
  end if;
  select * into v_user from auth.users where id = (p ->> 'user_id')::uuid;
  if lower(v_user.email) <> i.email then return jsonb_build_object('status', 'wrong_email', 'role', i.role, 'agencyName', v_agency); end if;
  if v_user.email_confirmed_at is null then return jsonb_build_object('status', 'email_unconfirmed', 'role', i.role, 'agencyName', v_agency); end if;
  return jsonb_build_object('status', 'ready', 'role', i.role, 'agencyName', v_agency);
end $$;

/** Authenticated: accept once, only for the confirmed email the invitation names. */
create or replace function app_api.accept_invitation(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i public.invitations; v_user auth.users; existing public.memberships;
begin
  if auth.uid() is null then perform app_private.fail('unauthenticated', 'Sign in first.'); end if;
  select * into i from public.invitations where token_hash = decode(p ->> 'token_hash', 'hex') for update;
  if not found then perform app_private.fail('invitation_invalid', 'This invitation link is not valid.'); end if;
  if i.revoked_at is not null then perform app_private.fail('invitation_revoked', 'This invitation was withdrawn.'); end if;
  if i.used_at is not null then perform app_private.fail('invitation_used', 'This invitation has already been used.'); end if;
  if i.expires_at <= now() then perform app_private.fail('invitation_expired', 'This invitation has expired.'); end if;
  select * into v_user from auth.users where id = auth.uid();
  if lower(v_user.email) <> i.email then perform app_private.fail('invitation_wrong_email', 'Sign in with the email address this invitation was sent to.'); end if;
  if v_user.email_confirmed_at is null then perform app_private.fail('email_unconfirmed', 'Confirm your email address first.'); end if;
  select * into existing from public.memberships where user_id = auth.uid();
  if found and existing.agency_id <> i.agency_id then perform app_private.fail('other_agency', 'This account already belongs to another agency.'); end if;
  if found then
    update public.memberships set role = i.role, active = true, deactivated_at = null where agency_id = i.agency_id and user_id = auth.uid();
  else
    insert into public.memberships(agency_id, user_id, role) values (i.agency_id, auth.uid(), i.role);
  end if;
  insert into public.profiles(user_id, display_name) values (auth.uid(), left(coalesce(nullif(p ->> 'display_name', ''), split_part(v_user.email, '@', 1)), 80))
    on conflict (user_id) do nothing;
  update public.invitations set used_at = now(), used_by = auth.uid() where id = i.id;
  perform app_private.audit(i.agency_id, 'invitation_accepted', 'invitation', i.id::text, jsonb_build_object('role', i.role));
  return jsonb_build_object('ok', true, 'role', i.role);
end $$;

-- ================================================================ manager operations
create or replace function app_api.create_invitation(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.memberships; a public.agencies; v_used int; v_id uuid; v_exp timestamptz; v_days int := coalesce((p ->> 'expires_in_days')::int, 7);
begin
  m := app_private.require_manager();
  if v_days not between 1 and 14 then perform app_private.fail('invalid_input', 'Expiry must be 1–14 days.'); end if;
  if length(coalesce(p ->> 'token_hash', '')) <> 64 then perform app_private.fail('invalid_input', 'Bad token hash.'); end if;
  if (p ->> 'role') not in ('rep', 'manager') then perform app_private.fail('invalid_input', 'Bad role.'); end if;
  select * into a from public.agencies where id = m.agency_id for update; -- serialises seat checks
  if (p ->> 'role') = 'rep' then
    select (select count(*) from public.memberships x where x.agency_id = m.agency_id and x.role = 'rep' and x.active)
         + (select count(*) from public.invitations x where x.agency_id = m.agency_id and x.role = 'rep' and x.used_at is null and x.revoked_at is null and x.expires_at > now())
      into v_used;
    if v_used >= a.seat_limit then perform app_private.fail('seat_limit', format('Seat limit reached (%s reps including pending invitations).', a.seat_limit)); end if;
  end if;
  v_exp := now() + make_interval(days => v_days);
  insert into public.invitations(agency_id, email, role, token_hash, expires_at, invited_by)
    values (m.agency_id, lower(btrim(p ->> 'email')), p ->> 'role', decode(p ->> 'token_hash', 'hex'), v_exp, m.user_id) returning id into v_id;
  perform app_private.audit(m.agency_id, 'invitation_created', 'invitation', v_id::text, jsonb_build_object('role', p ->> 'role'));
  return jsonb_build_object('id', v_id, 'expiresAt', v_exp);
end $$;

create or replace function app_api.revoke_invitation(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.memberships;
begin
  m := app_private.require_manager();
  update public.invitations set revoked_at = now()
   where id = (p ->> 'invitation_id')::uuid and agency_id = m.agency_id and used_at is null and revoked_at is null;
  if not found and not exists (select 1 from public.invitations where id = (p ->> 'invitation_id')::uuid and agency_id = m.agency_id) then
    perform app_private.fail('not_found', 'Invitation not found.');
  end if;
  perform app_private.audit(m.agency_id, 'invitation_revoked', 'invitation', p ->> 'invitation_id');
  return jsonb_build_object('ok', true);
end $$;

create or replace function app_api.set_member_active(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.memberships; target public.memberships; v_active boolean := (p ->> 'active')::boolean;
begin
  m := app_private.require_manager();
  if (p ->> 'user_id')::uuid = m.user_id then perform app_private.fail('forbidden', 'You cannot change your own membership.'); end if;
  select * into target from public.memberships where agency_id = m.agency_id and user_id = (p ->> 'user_id')::uuid for update;
  if not found then perform app_private.fail('not_found', 'Member not found.'); end if;
  if v_active and not target.active and target.role = 'rep' and
     (select count(*) from public.memberships x where x.agency_id = m.agency_id and x.role = 'rep' and x.active) >= (select seat_limit from public.agencies where id = m.agency_id) then
    perform app_private.fail('seat_limit', 'Seat limit reached.');
  end if;
  update public.memberships set active = v_active, deactivated_at = case when v_active then null else now() end
   where agency_id = m.agency_id and user_id = target.user_id;
  if not v_active then
    -- Revoke immediately, including any session in progress.
    perform app_private.close_session(s.id, 'membership_revoked') from public.sessions s
     where s.agency_id = m.agency_id and s.rep_id = target.user_id and s.status in ('created', 'active', 'ending');
  end if;
  perform app_private.audit(m.agency_id, case when v_active then 'member_reactivated' else 'member_deactivated' end, 'user', target.user_id::text);
  return jsonb_build_object('ok', true);
end $$;

create or replace function app_api.save_campaign_draft(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.memberships; cur public.campaign_versions; v_id uuid;
begin
  m := app_private.require_manager();
  if jsonb_typeof(p -> 'pack' -> 'approved_facts') <> 'array' or jsonb_array_length(p -> 'pack' -> 'approved_facts') = 0 then
    perform app_private.fail('invalid_pack', 'The pack needs at least one approved fact.');
  end if;
  if p ? 'rubric' and (jsonb_typeof(p -> 'rubric') <> 'array' or jsonb_array_length(p -> 'rubric') <> 5) then
    perform app_private.fail('invalid_rubric', 'The rubric needs exactly five dimensions.');
  end if;
  select * into cur from public.campaign_versions where agency_id = m.agency_id and state = 'published' order by version desc limit 1;
  update public.campaign_versions set pack = p -> 'pack', draft_rubric = p -> 'rubric', updated_at = now(), campaign_key = coalesce(cur.campaign_key, p -> 'pack' ->> 'campaign_key')
   where agency_id = m.agency_id and state = 'draft' returning id into v_id;
  if v_id is null then
    insert into public.campaign_versions(agency_id, campaign_key, version, pack, draft_rubric, state, created_by)
      values (m.agency_id, coalesce(cur.campaign_key, p -> 'pack' ->> 'campaign_key'), coalesce(cur.version, 0) + 1, p -> 'pack', p -> 'rubric', 'draft', m.user_id)
      returning id into v_id;
  end if;
  perform app_private.audit(m.agency_id, 'campaign_draft_saved', 'campaign_version', v_id::text);
  return jsonb_build_object('id', v_id);
end $$;

create or replace function app_api.publish_campaign(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.memberships; d public.campaign_versions; cur public.campaign_versions; cur_rubric public.rubric_versions;
        v_rubric uuid; v_version int; v_keys text[];
begin
  m := app_private.require_manager();
  select * into d from public.campaign_versions where agency_id = m.agency_id and state = 'draft' for update;
  if not found then perform app_private.fail('no_draft', 'There is no draft to publish.'); end if;
  -- Validate facts: unique IDs F<n>, non-empty text.
  if exists (select 1 from jsonb_array_elements(d.pack -> 'approved_facts') f where coalesce(f ->> 'id', '') !~ '^F[0-9]{1,2}$' or length(btrim(coalesce(f ->> 'text', ''))) = 0)
     or (select count(distinct f ->> 'id') from jsonb_array_elements(d.pack -> 'approved_facts') f) <> jsonb_array_length(d.pack -> 'approved_facts') then
    perform app_private.fail('invalid_pack', 'Every approved fact needs a unique ID and text.');
  end if;
  select * into cur from public.campaign_versions where agency_id = m.agency_id and state = 'published' order by version desc limit 1;
  select * into cur_rubric from public.rubric_versions where id = cur.rubric_version_id;
  v_rubric := cur.rubric_version_id;
  if d.draft_rubric is not null and (cur_rubric.id is null or d.draft_rubric <> cur_rubric.dimensions) then
    select array_agg(x ->> 'key' order by x ->> 'key') into v_keys from jsonb_array_elements(d.draft_rubric) x;
    if v_keys is distinct from array['accuracy', 'introduction', 'listening', 'next_step', 'respect'] then
      perform app_private.fail('invalid_rubric', 'The rubric needs each of the five dimensions exactly once.');
    end if;
    if exists (select 1 from jsonb_array_elements(d.draft_rubric) x where jsonb_array_length(coalesce(x -> 'anchors', '[]')) <> 5) then
      perform app_private.fail('invalid_rubric', 'Every dimension needs anchors for scores 1–5.');
    end if;
    insert into public.rubric_versions(agency_id, version, dimensions, prompt_version, approved_by, approved_at)
      values (m.agency_id, 'v' || ((select count(*) from public.rubric_versions where agency_id = m.agency_id) + 1), d.draft_rubric,
              coalesce(cur_rubric.prompt_version, 'evaluator-v2'), m.user_id, now())
      returning id into v_rubric;
  end if;
  if v_rubric is null then perform app_private.fail('invalid_rubric', 'A rubric is required to publish.'); end if;
  v_version := coalesce(cur.version, 0) + 1;
  update public.campaign_versions set state = 'published', version = v_version, pack = jsonb_set(d.pack, '{version}', to_jsonb(v_version)),
         rubric_version_id = v_rubric, draft_rubric = null, approved_by = m.user_id, approved_at = now(), updated_at = now()
   where id = d.id;
  perform app_private.audit(m.agency_id, 'campaign_published', 'campaign_version', d.id::text, jsonb_build_object('version', v_version));
  return jsonb_build_object('version', v_version);
end $$;

create or replace function app_api.add_review(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.memberships; s public.sessions; v_id uuid; v_report uuid := nullif(p ->> 'report_id', '')::uuid;
begin
  m := app_private.require_manager();
  select * into s from public.sessions where id = (p ->> 'session_id')::uuid and agency_id = m.agency_id;
  if not found then perform app_private.fail('not_found', 'Session not found.'); end if;
  if v_report is not null and not exists (select 1 from public.feedback_reports r where r.id = v_report and r.session_id = s.id) then
    perform app_private.fail('invalid_input', 'That report belongs to a different session.');
  end if;
  insert into public.manager_reviews(agency_id, session_id, manager_id, note, resolution, report_id)
    values (s.agency_id, s.id, m.user_id, left(p ->> 'note', 2000), p ->> 'resolution', v_report) returning id into v_id;
  if v_report is not null and (p ->> 'resolution') = 'resolved' then
    update public.feedback_reports set status = 'resolved', reviewed_by = m.user_id, reviewed_at = now() where id = v_report;
  end if;
  perform app_private.audit(m.agency_id, 'review_added', 'session', s.id::text, jsonb_build_object('resolution', p ->> 'resolution'));
  return jsonb_build_object('id', v_id);
end $$;

create or replace function app_api.add_correction(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.memberships; s public.sessions; v_rev int;
begin
  m := app_private.require_manager();
  select * into s from public.sessions where id = (p ->> 'session_id')::uuid and agency_id = m.agency_id for update;
  if not found then perform app_private.fail('not_found', 'Session not found.'); end if;
  if exists (select 1 from public.turn_corrections where session_id = s.id and request_id = p ->> 'request_id') then
    return app_private.session_json(s.id);
  end if;
  if s.status <> 'ended' then perform app_private.fail('session_active', 'Corrections apply to ended sessions.'); end if;
  if not exists (select 1 from public.turns where session_id = s.id and label = p ->> 'turn_label' and speaker = 'rep') then
    perform app_private.fail('invalid_turn', 'Choose one of the rep turns.');
  end if;
  v_rev := s.transcript_revision + 1;
  insert into public.turn_corrections(agency_id, session_id, turn_label, revision, corrected_text, note, corrected_by, request_id)
    values (s.agency_id, s.id, p ->> 'turn_label', v_rev, left(btrim(p ->> 'corrected_text'), 1200), nullif(left(p ->> 'note', 500), ''), m.user_id, p ->> 'request_id');
  update public.sessions set transcript_revision = v_rev, evaluation_status = 'pending' where id = s.id;
  insert into public.evaluation_jobs(agency_id, session_id, transcript_revision) values (s.agency_id, s.id, v_rev);
  -- Audit stores no transcript text.
  perform app_private.audit(m.agency_id, 'transcript_corrected', 'session', s.id::text, jsonb_build_object('revision', v_rev, 'turn', p ->> 'turn_label'));
  return app_private.session_json(s.id);
end $$;

-- ================================================================ service-only operations
create or replace function app_api.commit_resident_turn(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.sessions; v_req text := p ->> 'request_id'; v_text text := btrim(coalesce(p ->> 'text', '')); v_n int; v_seq int;
begin
  select * into s from public.sessions where id = (p ->> 'session_id')::uuid for update;
  if not found then perform app_private.fail('not_found', 'Session not found.'); end if;
  if exists (select 1 from public.turns where session_id = s.id and request_id = v_req || ':resident') or
     (s.turn_lock is distinct from v_req and exists (select 1 from public.turns where session_id = s.id and request_id = v_req)) then
    return app_private.session_json(s.id); -- already applied
  end if;
  if s.turn_lock is distinct from v_req then perform app_private.fail('lock_mismatch', 'Turn is not in progress.'); end if;
  if s.status = 'active' and v_text <> '' then
    select count(*) filter (where speaker = 'resident') + 1, max(sequence) + 1 into v_n, v_seq from public.turns where session_id = s.id;
    insert into public.turns(agency_id, session_id, sequence, label, speaker, text, source, request_id)
      values (s.agency_id, s.id, v_seq, 'resident-' || v_n, 'resident', left(v_text, 400), coalesce(p ->> 'source', 'generated'), v_req || ':resident');
  end if;
  update public.sessions set turn_lock = null, turn_lock_at = null where id = s.id;
  if coalesce((p ->> 'end')::boolean, false) or app_private.deadline_passed(s) then
    perform app_private.close_session(s.id, coalesce(p ->> 'end_reason', 'resident_ended'));
  end if;
  return app_private.session_json(s.id);
end $$;

create or replace function app_api.release_turn(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update public.sessions set turn_lock = null, turn_lock_at = null where id = (p ->> 'session_id')::uuid and turn_lock = p ->> 'request_id';
  return jsonb_build_object('ok', true);
end $$;

create or replace function app_api.fail_session(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.close_session((p ->> 'session_id')::uuid, 'provider_failure');
  return app_private.session_json((p ->> 'session_id')::uuid);
end $$;

/** Reserve estimated provider spend before a call. Idempotent per operation_id; never reissues uncertain calls. */
create or replace function app_api.begin_provider_attempt(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.provider_attempts; s public.sessions; per public.usage_periods; v_global bigint; v_agency bigint; v_est bigint := (p ->> 'estimated_cost_minor')::bigint;
begin
  select * into a from public.provider_attempts where operation_id = p ->> 'operation_id';
  if found then return jsonb_build_object('existing', true, 'state', a.state); end if;
  select * into s from public.sessions where id = (p ->> 'session_id')::uuid;
  if not found then perform app_private.fail('not_found', 'Session not found.'); end if;
  perform pg_advisory_xact_lock(hashtext('pitchready_provider_spend'));
  select coalesce(sum(coalesce(actual_cost_minor, estimated_cost_minor)), 0) into v_global from public.provider_attempts
   where created_at >= date_trunc('month', now()) and currency = p ->> 'currency';
  select * into per from public.usage_periods where id = s.usage_period_id for update;
  select coalesce(sum(coalesce(actual_cost_minor, estimated_cost_minor)), 0) into v_agency from public.provider_attempts
   where agency_id = s.agency_id and created_at >= per.starts_at and created_at < per.ends_at and currency = p ->> 'currency';
  if v_global + v_est > (p ->> 'global_budget_minor')::bigint then perform app_private.fail('spend_budget_exceeded', 'Practice is paused: the service spend limit has been reached.'); end if;
  if v_agency + v_est > (p ->> 'agency_budget_minor')::bigint then perform app_private.fail('spend_budget_exceeded', 'Practice is paused: your agency''s AI spend limit has been reached.'); end if;
  insert into public.provider_attempts(agency_id, session_id, turn_label, operation_id, operation, provider, model, state, estimated_cost_minor, currency)
    values (s.agency_id, s.id, nullif(p ->> 'turn_label', ''), p ->> 'operation_id', p ->> 'operation', p ->> 'provider', p ->> 'model', 'in_flight', v_est, p ->> 'currency');
  update public.usage_periods set spend_reserved_minor = spend_reserved_minor + v_est where id = per.id;
  return jsonb_build_object('existing', false, 'state', 'in_flight');
end $$;

create or replace function app_api.finish_provider_attempt(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.provider_attempts; s public.sessions; v_charge bigint;
begin
  select * into a from public.provider_attempts where operation_id = p ->> 'operation_id' for update;
  if not found then perform app_private.fail('not_found', 'Attempt not found.'); end if;
  if a.state <> 'in_flight' then return jsonb_build_object('state', a.state); end if;
  update public.provider_attempts set state = p ->> 'state', provider_request_id = nullif(p ->> 'provider_request_id', ''), units = p -> 'units',
         actual_cost_minor = nullif(p ->> 'actual_cost_minor', '')::bigint, cost_status = coalesce(p ->> 'cost_status', 'estimated'),
         error_code = nullif(p ->> 'error_code', ''), finished_at = now()
   where id = a.id;
  -- Unknown/uncertain usage keeps the conservative estimate as the charge.
  v_charge := coalesce(nullif(p ->> 'actual_cost_minor', '')::bigint, a.estimated_cost_minor);
  select * into s from public.sessions where id = a.session_id;
  update public.usage_periods set spend_reserved_minor = greatest(0, spend_reserved_minor - a.estimated_cost_minor), spend_actual_minor = spend_actual_minor + v_charge
   where id = s.usage_period_id;
  return jsonb_build_object('state', p ->> 'state');
end $$;

create or replace function app_api.claim_evaluation_job(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j public.evaluation_jobs; s public.sessions; cv public.campaign_versions; rv public.rubric_versions; sv public.scenario_versions;
begin
  select * into j from public.evaluation_jobs
   where (nullif(p ->> 'session_id', '') is null or session_id = (p ->> 'session_id')::uuid)
     and (status = 'pending' or (status = 'running' and lease_until < now()))
   order by created_at limit 1 for update skip locked;
  if not found then return null; end if;
  select * into s from public.sessions where id = j.session_id;
  if j.attempts >= 3 then
    update public.evaluation_jobs set status = 'failed', updated_at = now() where session_id = j.session_id and transcript_revision = j.transcript_revision;
    update public.sessions set evaluation_status = 'unavailable' where id = s.id and transcript_revision = j.transcript_revision;
    return null;
  end if;
  update public.evaluation_jobs set status = 'running', attempts = attempts + 1, lease_until = now() + make_interval(secs => coalesce((p ->> 'lease_seconds')::int, 90)), updated_at = now()
   where session_id = j.session_id and transcript_revision = j.transcript_revision;
  update public.sessions set evaluation_status = 'running' where id = s.id and transcript_revision = j.transcript_revision;
  select * into cv from public.campaign_versions where id = s.campaign_version_id;
  select * into rv from public.rubric_versions where id = s.rubric_version_id;
  select * into sv from public.scenario_versions where id = s.scenario_version_id;
  return jsonb_build_object(
    'session_id', s.id, 'agency_id', s.agency_id, 'transcript_revision', j.transcript_revision, 'attempt', j.attempts + 1,
    'scenario_key', sv.scenario_key, 'drill_key', s.drill_key, 'scenario', to_jsonb(sv) - 'agency_id' - 'id',
    'campaign', cv.pack, 'rubric', jsonb_build_object('version', rv.version, 'prompt_version', rv.prompt_version, 'dimensions', rv.dimensions),
    'transcript', coalesce((select jsonb_agg(jsonb_build_object('id', t.label, 'speaker', t.speaker, 'text', t.text, 'corrected', t.corrected) order by t.seq)
                            from app_private.transcript_at(s.id, j.transcript_revision) t), '[]'::jsonb));
end $$;

/** Second line of defence: evidence must quote the frozen transcript exactly. Returns problems. */
create or replace function app_private.evidence_problems(p_session uuid, p_revision int, r jsonb) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare problems text[] := '{}'; ev jsonb; v_text text;
begin
  for ev in
    select e from jsonb_array_elements(coalesce(r -> 'dimensions', '[]')) d, jsonb_array_elements(coalesce(d -> 'evidence', '[]')) e
    union all
    select e from jsonb_array_elements(coalesce(r -> 'concerns', '[]')) c, jsonb_array_elements(coalesce(c -> 'evidence', '[]')) e
  loop
    select t.text into v_text from app_private.transcript_at(p_session, p_revision) t where t.label = ev ->> 'turn_id';
    if v_text is null then problems := problems || format('unknown turn %s', ev ->> 'turn_id');
    elsif coalesce(ev ->> 'quote', '') = '' or strpos(v_text, ev ->> 'quote') = 0 then problems := problems || format('quote not found in %s', ev ->> 'turn_id');
    end if;
  end loop;
  if (select count(distinct d ->> 'key') from jsonb_array_elements(coalesce(r -> 'dimensions', '[]')) d) <> 5 then problems := problems || 'dimensions must be the five keys once each'::text; end if;
  if (r ->> 'transcript_revision')::int is distinct from p_revision then problems := problems || 'transcript_revision mismatch'::text; end if;
  return problems;
end $$;

create or replace function app_api.save_evaluation(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j public.evaluation_jobs; s public.sessions; v_status text := p ->> 'status'; v_problems text[];
begin
  select * into j from public.evaluation_jobs where session_id = (p ->> 'session_id')::uuid and transcript_revision = (p ->> 'transcript_revision')::int for update;
  if not found then perform app_private.fail('not_found', 'Evaluation job not found.'); end if;
  select * into s from public.sessions where id = j.session_id for update;
  if exists (select 1 from public.evaluations where session_id = s.id and transcript_revision = j.transcript_revision and status = 'completed') then
    update public.evaluation_jobs set status = 'done', updated_at = now() where session_id = j.session_id and transcript_revision = j.transcript_revision;
    return jsonb_build_object('status', 'completed', 'duplicate', true);
  end if;
  if v_status = 'completed' then
    v_problems := app_private.evidence_problems(s.id, j.transcript_revision, p -> 'result');
    if array_length(v_problems, 1) > 0 then v_status := 'unavailable'; end if;
  end if;
  insert into public.evaluations(agency_id, session_id, transcript_revision, attempt, status, evaluator_kind, result, model, prompt_version, errors)
    values (s.agency_id, s.id, j.transcript_revision, j.attempts, v_status, p ->> 'evaluator_kind',
            case when v_status = 'completed' then p -> 'result' end, p ->> 'model', p ->> 'prompt_version',
            case when v_status = 'completed' then null else coalesce(to_jsonb(v_problems), p -> 'errors') end);
  update public.evaluation_jobs set status = case when v_status = 'completed' then 'done' else 'failed' end, lease_until = null,
         last_error_code = case when v_status = 'completed' then null else 'invalid_output' end, updated_at = now()
   where session_id = j.session_id and transcript_revision = j.transcript_revision;
  if s.transcript_revision = j.transcript_revision then
    update public.sessions set evaluation_status = v_status where id = s.id;
  end if;
  return jsonb_build_object('status', v_status, 'problems', to_jsonb(v_problems));
end $$;

/** Transient provider error: put the job back for the worker (bounded by attempts). */
create or replace function app_api.defer_evaluation_job(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j public.evaluation_jobs;
begin
  select * into j from public.evaluation_jobs where session_id = (p ->> 'session_id')::uuid and transcript_revision = (p ->> 'transcript_revision')::int for update;
  if not found then return jsonb_build_object('ok', false); end if;
  update public.evaluation_jobs set status = case when j.attempts >= 3 then 'failed' else 'pending' end, lease_until = null,
         last_error_code = left(p ->> 'error_code', 60), updated_at = now()
   where session_id = j.session_id and transcript_revision = j.transcript_revision;
  update public.sessions set evaluation_status = case when j.attempts >= 3 then 'unavailable' else 'pending' end
   where id = j.session_id and transcript_revision = j.transcript_revision;
  return jsonb_build_object('ok', true);
end $$;

/** Recover stuck state and apply retention. Called by the authenticated maintenance route. */
create or replace function app_api.maintenance_run(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_closed int := 0; v_deleted int := 0; v_leases int := 0; v_req int := 0; r record; a record; n int;
        v_grace interval := make_interval(secs => coalesce((p ->> 'abandon_grace_seconds')::int, 120));
begin
  for r in select id, exists (select 1 from public.turns t where t.session_id = s.id and t.speaker = 'rep') has_rep from public.sessions s
           where (status in ('active', 'ending') and deadline_at + v_grace < now())
              or (status = 'created' and created_at < now() - interval '2 minutes')
  loop
    perform app_private.close_session(r.id, case when r.has_rep then 'time_limit' else 'abandoned' end);
    v_closed := v_closed + 1;
  end loop;
  update public.sessions set turn_lock = null, turn_lock_at = null where turn_lock is not null and turn_lock_at < now() - interval '5 minutes';
  update public.evaluation_jobs set status = 'pending', lease_until = null, updated_at = now() where status = 'running' and lease_until < now();
  get diagnostics v_leases = row_count;

  perform set_config('pitchready.retention', 'on', true);
  -- Deletion requests (proposed policy: honoured at the next maintenance run).
  for r in select * from public.deletion_requests where status = 'requested' loop
    delete from public.sessions where agency_id = r.agency_id and rep_id = r.user_id and status not in ('created', 'active', 'ending');
    delete from public.feedback_reports where agency_id = r.agency_id and reporter_id = r.user_id;
    if r.scope = 'my_account' then
      update public.memberships set active = false, deactivated_at = now() where agency_id = r.agency_id and user_id = r.user_id;
    end if;
    update public.deletion_requests set status = 'completed', resolved_at = now() where id = r.id;
    insert into public.audit_events(agency_id, actor_id, action, target_type, target_id) values (r.agency_id, null, 'deletion_request_completed', 'deletion_request', r.id::text);
    v_req := v_req + 1;
  end loop;
  -- Retention: transcripts, corrections, evaluations, reports and reviews go with the session (cascade).
  -- usage_ledger and provider_attempts keep aggregate numbers without transcript text.
  for a in select id, retention_days from public.agencies loop
    delete from public.sessions where agency_id = a.id and status not in ('created', 'active', 'ending')
      and coalesce(ended_at, created_at) < now() - make_interval(days => a.retention_days);
    get diagnostics n = row_count;
    if n > 0 then
      insert into public.audit_events(agency_id, actor_id, action, metadata) values (a.id, null, 'retention_deleted', jsonb_build_object('sessions', n));
      v_deleted := v_deleted + n;
    end if;
  end loop;
  perform set_config('pitchready.retention', 'off', true);
  return jsonb_build_object('closed_sessions', v_closed, 'leases_reset', v_leases, 'deletion_requests', v_req, 'retention_deleted_sessions', v_deleted);
end $$;

-- ================================================================ read functions (SECURITY INVOKER: RLS applies)
create or replace function app_api.my_context() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'membership', (select jsonb_build_object('agencyId', m.agency_id, 'role', m.role, 'active', m.active) from public.memberships m where m.user_id = (select auth.uid())),
    'profile', (select jsonb_build_object('displayName', p.display_name) from public.profiles p where p.user_id = (select auth.uid())),
    'agency', (select jsonb_build_object('name', a.name, 'retentionDays', a.retention_days) from public.agencies a limit 1),
    'campaign', (select jsonb_build_object('version', c.version, 'pack', c.pack, 'rubricVersion', r.version)
                 from public.campaign_versions c join public.rubric_versions r on r.id = c.rubric_version_id
                 where c.state = 'published' order by c.version desc limit 1),
    'scenarios', coalesce((select jsonb_agg(x order by x ->> 'key') from (
                   select distinct on (s.scenario_key) jsonb_build_object('key', s.scenario_key, 'version', s.version, 'title', s.title, 'persona', s.persona,
                     'opener', s.opener, 'objection', s.objection, 'goal', s.goal, 'allowedEnding', s.allowed_ending, 'behaviour', s.behaviour, 'skill', s.skill) x
                   from public.scenario_versions s order by s.scenario_key, s.version desc) q), '[]'::jsonb),
    'usage', (select jsonb_build_object('allowanceSeconds', u.allowance_seconds, 'consumedSeconds', u.consumed_seconds, 'reservedSeconds', u.reserved_seconds, 'periodEnd', u.ends_at)
              from public.usage_periods u where u.starts_at <= now() and u.ends_at > now() order by u.starts_at desc limit 1)
  )
$$;

create or replace function app_api.list_my_sessions() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(app_private.session_json(s.id) order by s.created_at desc), '[]'::jsonb)
  from public.sessions s where s.rep_id = (select auth.uid())
$$;

create or replace function app_api.get_session(p jsonb) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select case when s.id is null then null else jsonb_build_object(
    'session', app_private.session_json(s.id),
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'sessionId', r.session_id, 'reporterId', r.reporter_id, 'reason', r.reason,
                         'description', r.description, 'status', r.status, 'createdAt', r.created_at) order by r.created_at)
                         from public.feedback_reports r where r.session_id = s.id), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'sessionId', v.session_id, 'managerId', v.manager_id,
                         'managerName', coalesce((select p2.display_name from public.profiles p2 where p2.user_id = v.manager_id), 'Manager'),
                         'note', v.note, 'resolution', v.resolution, 'createdAt', v.created_at) order by v.created_at)
                         from public.manager_reviews v where v.session_id = s.id), '[]'::jsonb)) end
  from (select (p ->> 'session_id')::uuid as want) w
  left join public.sessions s on s.id = w.want
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
        'id', s.id, 'repId', s.rep_id, 'repName', coalesce(pr.display_name, 'Rep'), 'scenarioKey', sv.scenario_key, 'drillKey', s.drill_key,
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

create or replace function app_api.manager_roster() returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare m public.memberships;
begin
  select * into m from public.memberships where user_id = (select auth.uid()) and active and role = 'manager';
  if not found then perform app_private.fail('forbidden', 'Manager access required.'); end if;
  return jsonb_build_object(
    'seatLimit', (select seat_limit from public.agencies where id = m.agency_id),
    'members', coalesce((select jsonb_agg(jsonb_build_object('userId', x.user_id, 'name', coalesce(pr.display_name, 'Member'), 'email', '',
                 'role', x.role, 'active', x.active, 'sessions', (select count(*) from public.sessions s where s.rep_id = x.user_id and s.agency_id = m.agency_id)) order by x.created_at)
                 from public.memberships x left join public.profiles pr on pr.user_id = x.user_id where x.agency_id = m.agency_id), '[]'::jsonb),
    'invitations', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'role', i.role, 'createdAt', i.created_at, 'expiresAt', i.expires_at,
                 'usedAt', i.used_at, 'revokedAt', i.revoked_at) order by i.created_at desc)
                 from public.invitations i where i.agency_id = m.agency_id), '[]'::jsonb));
end $$;

create or replace function app_api.campaign_admin() returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare m public.memberships;
begin
  select * into m from public.memberships where user_id = (select auth.uid()) and active and role = 'manager';
  if not found then perform app_private.fail('forbidden', 'Manager access required.'); end if;
  return jsonb_build_object(
    'published', coalesce((select jsonb_agg(jsonb_build_object('version', c.version, 'pack', c.pack, 'publishedAt', c.approved_at,
                   'approvedBy', coalesce((select p.display_name from public.profiles p where p.user_id = c.approved_by), 'Manager'),
                   'rubric', jsonb_build_object('version', r.version, 'promptVersion', r.prompt_version, 'dimensions', r.dimensions, 'approvedAt', r.approved_at, 'approvedBy', null)) order by c.version)
                 from public.campaign_versions c join public.rubric_versions r on r.id = c.rubric_version_id
                 where c.agency_id = m.agency_id and c.state = 'published'), '[]'::jsonb),
    'draft', (select jsonb_build_object('pack', c.pack, 'updatedAt', c.updated_at,
                'rubric', jsonb_build_object('version', 'draft', 'promptVersion', 'evaluator-v2', 'dimensions', coalesce(c.draft_rubric, cur.dimensions), 'approvedAt', null, 'approvedBy', null))
              from public.campaign_versions c
              left join lateral (select r.dimensions from public.campaign_versions c2 join public.rubric_versions r on r.id = c2.rubric_version_id
                                 where c2.agency_id = m.agency_id and c2.state = 'published' order by c2.version desc limit 1) cur on true
              where c.agency_id = m.agency_id and c.state = 'draft'));
end $$;

-- ================================================================ bootstrap (owner-only; run from the server CLI)
create or replace function app_private.bootstrap_agency(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_agency uuid; v_user uuid; v_rubric uuid; s jsonb;
begin
  select id into v_user from auth.users where lower(email) = lower(p ->> 'manager_email');
  if v_user is null then perform app_private.fail('manager_not_found', 'Create the manager''s auth account first (sign up), then re-run.'); end if;
  if exists (select 1 from public.memberships where user_id = v_user) then perform app_private.fail('already_member', 'That user already belongs to an agency.'); end if;
  insert into public.agencies(name, retention_days, seat_limit) values (p ->> 'agency_name', coalesce((p ->> 'retention_days')::int, 30), coalesce((p ->> 'seat_limit')::int, 5))
    returning id into v_agency;
  insert into public.memberships(agency_id, user_id, role) values (v_agency, v_user, 'manager');
  insert into public.profiles(user_id, display_name) values (v_user, coalesce(p ->> 'manager_name', split_part(p ->> 'manager_email', '@', 1)))
    on conflict (user_id) do nothing;
  insert into public.rubric_versions(agency_id, version, dimensions, prompt_version, approved_by, approved_at)
    values (v_agency, p -> 'rubric' ->> 'version', p -> 'rubric' -> 'dimensions', p -> 'rubric' ->> 'prompt_version', v_user, now()) returning id into v_rubric;
  insert into public.campaign_versions(agency_id, campaign_key, version, pack, rubric_version_id, state, approved_by, approved_at, created_by)
    values (v_agency, p -> 'campaign' ->> 'campaign_key', 1, p -> 'campaign', v_rubric, 'published', v_user, now(), v_user);
  for s in select * from jsonb_array_elements(p -> 'scenarios') loop
    insert into public.scenario_versions(agency_id, scenario_key, version, title, persona, opener, objection, goal, allowed_ending, behaviour, skill)
      values (v_agency, s ->> 'key', 1, s ->> 'title', s ->> 'persona', s ->> 'opener', s ->> 'objection', s ->> 'goal', s ->> 'allowedEnding', s ->> 'behaviour', s ->> 'skill');
  end loop;
  insert into public.usage_periods(agency_id, starts_at, ends_at, allowance_seconds)
    values (v_agency, now(), now() + make_interval(days => coalesce((p ->> 'period_days')::int, 14)), coalesce((p ->> 'allowance_seconds')::int, 9000));
  insert into public.audit_events(agency_id, actor_id, action, target_type, target_id) values (v_agency, v_user, 'agency_bootstrapped', 'agency', v_agency::text);
  return v_agency;
end $$;

-- ================================================================ grants
revoke all on all functions in schema app_api from public, anon, authenticated, service_role;
revoke all on all functions in schema app_private from public, anon, authenticated, service_role;
grant usage on schema app_api to authenticated, service_role;

-- Signed-in clients (identity from JWT):
grant execute on function
  app_api.start_session(jsonb), app_api.activate_session(jsonb), app_api.begin_turn(jsonb), app_api.commit_rep_turn(jsonb),
  app_api.end_session(jsonb), app_api.report_feedback(jsonb), app_api.request_evaluation(jsonb), app_api.request_deletion(jsonb),
  app_api.accept_invitation(jsonb), app_api.create_invitation(jsonb), app_api.revoke_invitation(jsonb), app_api.set_member_active(jsonb),
  app_api.save_campaign_draft(jsonb), app_api.publish_campaign(jsonb), app_api.add_review(jsonb), app_api.add_correction(jsonb),
  app_api.my_context(), app_api.list_my_sessions(), app_api.get_session(jsonb), app_api.manager_summaries(), app_api.manager_roster(), app_api.campaign_admin()
to authenticated;

-- Trusted server only (Supabase secret key):
grant execute on function
  app_api.inspect_invitation(jsonb), app_api.commit_resident_turn(jsonb), app_api.release_turn(jsonb), app_api.fail_session(jsonb),
  app_api.begin_provider_attempt(jsonb), app_api.finish_provider_attempt(jsonb), app_api.claim_evaluation_job(jsonb),
  app_api.save_evaluation(jsonb), app_api.defer_evaluation_job(jsonb), app_api.maintenance_run(jsonb)
to service_role;

-- Helpers needed while evaluating invoker functions and RLS policies:
grant execute on function app_private.my_role(uuid), app_private.is_member(uuid), app_private.is_manager(uuid), app_private.can_read_session(uuid),
  app_private.session_json(uuid), app_private.transcript_at(uuid, int), app_private.fail(text, text) to authenticated, service_role;
-- app_private.bootstrap_agency: no grants. Only the database owner can run it (scripts/bootstrap-agency.ts).
