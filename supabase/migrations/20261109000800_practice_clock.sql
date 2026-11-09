-- Practice sessions: a fairer clock and a choice of length (DECISIONS D35).
--
-- 1. The clock pauses while the AI works on a turn. A turn holds the session's turn lock from the
--    moment the rep's reply arrives (begin_turn for speech, commit_rep_turn for typing) until the
--    customer's reply is stored (commit_resident_turn) or the turn is released (release_turn). That
--    time, capped at 90 seconds a turn, is added back to the deadline and not charged.
-- 2. Managers choose 3, 5 or 10-minute full sessions in the campaign (pack.practice_minutes); replies
--    scale with time (12, 20 or 40). Drills stay 60 seconds / 5 replies.
--
-- Backwards compatible: new column has a default, constraints only widen, and every function keeps
-- its signature, so the previous app version keeps working against this schema.

alter table public.sessions add column if not exists paused_seconds int not null default 0 check (paused_seconds >= 0);

alter table public.sessions drop constraint if exists sessions_max_seconds_check;
alter table public.sessions add constraint sessions_max_seconds_check check (max_seconds in (60, 180, 300, 600));
alter table public.sessions drop constraint if exists sessions_max_rep_turns_check;
alter table public.sessions add constraint sessions_max_rep_turns_check check (max_rep_turns between 1 and 40);
alter table public.turns drop constraint if exists turns_sequence_check;
alter table public.turns add constraint turns_sequence_check check (sequence between 1 and 90);

-- ---------------------------------------------------------------- pause helpers
/** Time the AI has been working on the current turn, capped; zero when no turn is in progress. */
create or replace function app_private.pause_credit(s public.sessions) returns interval
language sql stable set search_path = '' as $$
  select case when s.turn_lock is not null and s.turn_lock_at is not null
              then least(greatest(now() - s.turn_lock_at, interval '0'), interval '90 seconds')
              else interval '0' end
$$;

/** The deadline, counting a pause in progress. */
create or replace function app_private.deadline_passed(s public.sessions) returns boolean
language sql stable set search_path = '' as $$ select s.deadline_at is not null and now() >= s.deadline_at + app_private.pause_credit(s) $$;

/** Ends the pause for the current turn: credits the time back to the deadline and clears the lock. Caller holds the row lock. */
create or replace function app_private.resume_clock(p_session uuid) returns public.sessions
language plpgsql security definer set search_path = '' as $$
declare s public.sessions; v_credit interval;
begin
  select * into s from public.sessions where id = p_session;
  v_credit := app_private.pause_credit(s);
  update public.sessions set
    deadline_at = case when status = 'active' then deadline_at + v_credit else deadline_at end,
    paused_seconds = paused_seconds + case when status = 'active' then floor(extract(epoch from v_credit))::int else 0 end,
    turn_lock = null, turn_lock_at = null
  where id = p_session
  returning * into s;
  return s;
end $$;

-- ---------------------------------------------------------------- settlement (charges time minus pauses)
create or replace function app_private.close_session(p_session uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions; v_end timestamptz; v_used int; v_status text; v_reason text; v_has_rep boolean; v_refund boolean;
  v_credit interval; v_deadline timestamptz; v_paused int;
begin
  select * into s from public.sessions where id = p_session for update;
  if not found or s.status not in ('created', 'active', 'ending') then return; end if;
  -- A pause still in progress (the AI was working when the session closed) also counts.
  v_credit := app_private.pause_credit(s);
  v_deadline := s.deadline_at + v_credit;
  v_paused := s.paused_seconds + floor(extract(epoch from v_credit))::int;
  v_end := least(now(), coalesce(v_deadline, now()));
  v_has_rep := exists (select 1 from public.turns t where t.session_id = s.id and t.speaker = 'rep');
  v_reason := case when v_deadline is not null and now() >= v_deadline and p_reason in ('rep_ended', 'resident_ended', 'turn_limit') then 'time_limit' else p_reason end;
  v_refund := v_reason = 'provider_failure' or (v_reason = 'abandoned' and not v_has_rep) or s.started_at is null;
  v_status := case when v_reason = 'provider_failure' then 'failed'
                   when s.started_at is null then 'abandoned' -- never activated: nothing to charge or evaluate
                   when v_reason = 'abandoned' and not v_has_rep then 'abandoned'
                   else 'ended' end;
  v_used := case when v_refund or s.started_at is null then 0
                 else least(s.max_seconds, greatest(0, ceil(extract(epoch from (v_end - s.started_at))) - v_paused))::int end;

  update public.usage_periods set reserved_seconds = reserved_seconds - s.max_seconds, consumed_seconds = consumed_seconds + v_used
   where id = s.usage_period_id;
  insert into public.usage_ledger(agency_id, period_id, session_id, operation_id, kind, seconds) values
    (s.agency_id, s.usage_period_id, s.id, 'settle:' || s.id, 'settlement', v_used),
    (s.agency_id, s.usage_period_id, s.id, case when v_refund then 'refund:' else 'release:' end || s.id, case when v_refund then 'refund' else 'release' end, s.max_seconds - v_used);

  update public.sessions set
    status = v_status, end_reason = v_reason, ended_at = case when s.started_at is null then now() else v_end end,
    used_seconds = v_used, turn_lock = null, turn_lock_at = null, paused_seconds = v_paused,
    deadline_at = coalesce(v_deadline, deadline_at),
    evaluation_status = case when v_status = 'ended' then 'pending' else 'none' end
  where id = s.id;

  if v_status = 'ended' then
    insert into public.evaluation_jobs(agency_id, session_id, transcript_revision) values (s.agency_id, s.id, s.transcript_revision)
    on conflict do nothing;
  end if;
end $$;

-- ---------------------------------------------------------------- turns
/** Reserve the single in-flight turn slot before slow work (speech-to-text). Starts the pause. Idempotent. */
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
  -- A retry of the same turn keeps its original pause start.
  update public.sessions set turn_lock = v_req, turn_lock_at = case when turn_lock = v_req then turn_lock_at else now() end where id = s.id;
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
  -- The pause runs from when the reply arrived (begin_turn for speech), not from here.
  update public.sessions set turn_lock = v_req, turn_lock_at = case when turn_lock = v_req then turn_lock_at else now() end where id = s.id;
  return jsonb_build_object('ok', true, 'duplicate', false, 'session', app_private.session_json(s.id));
end $$;

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
  if coalesce((p ->> 'end')::boolean, false) then
    perform app_private.close_session(s.id, coalesce(p ->> 'end_reason', 'resident_ended'));
  else
    s := app_private.resume_clock(s.id);
    if app_private.deadline_passed(s) then perform app_private.close_session(s.id, 'time_limit'); end if;
  end if;
  return app_private.session_json(s.id);
end $$;

create or replace function app_api.release_turn(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.sessions;
begin
  select * into s from public.sessions where id = (p ->> 'session_id')::uuid and turn_lock = p ->> 'request_id' for update;
  if found then perform app_private.resume_clock(s.id); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- practice length
create or replace function app_api.start_session(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.memberships; s public.sessions; per public.usage_periods; cv public.campaign_versions; sv public.scenario_versions;
  v_req text := p ->> 'request_id'; v_drill text := nullif(p ->> 'drill_key', ''); v_parent uuid := nullif(p ->> 'parent_session_id', '')::uuid;
  v_scenario text := p ->> 'scenario_key'; v_kind text; v_max int; v_turns int; v_opener text; v_minutes int;
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

  if v_parent is not null and not exists (select 1 from public.sessions x where x.id = v_parent and x.agency_id = m.agency_id and x.rep_id = m.user_id) then
    perform app_private.fail('invalid_parent', 'Drill parent must be one of your sessions.');
  end if;

  perform app_private.close_session(x.id, case when exists (select 1 from public.turns t where t.session_id = x.id and t.speaker = 'rep') then 'time_limit' else 'abandoned' end)
    from public.sessions x where x.rep_id = m.user_id and x.status in ('created', 'active', 'ending')
      and coalesce(x.deadline_at + app_private.pause_credit(x), x.created_at + interval '2 minutes') < now();
  if exists (select 1 from public.sessions x where x.rep_id = m.user_id and x.status in ('created', 'active', 'ending')) then
    perform app_private.fail('session_in_progress', 'Finish or end your current practice first.');
  end if;

  select * into cv from public.campaign_versions where agency_id = m.agency_id and state = 'published' order by version desc limit 1;
  if not found then perform app_private.fail('no_published_campaign', 'Your agency has not published a campaign yet.'); end if;
  -- Session length comes from the published campaign (3, 5 or 10 minutes); drills are always 60 seconds.
  v_minutes := case when cv.pack ->> 'practice_minutes' in ('3', '5', '10') then (cv.pack ->> 'practice_minutes')::int else 3 end;
  v_max := case when v_kind = 'full' then v_minutes * 60 else 60 end;
  v_turns := case when v_kind = 'drill' then 5 when v_minutes = 10 then 40 when v_minutes = 5 then 20 else 12 end;

  -- A retry drill keeps the person from the session it retries (any sales setting); without a
  -- parent it falls back to the built-in scenario the drill is mapped to.
  if v_drill is not null and v_parent is not null then
    select sv2.* into sv from public.sessions x join public.scenario_versions sv2 on sv2.id = x.scenario_version_id
     where x.id = v_parent and x.agency_id = m.agency_id and x.rep_id = m.user_id;
  end if;
  if sv.id is null then
    select * into sv from app_private.latest_scenarios(m.agency_id) x where x.scenario_key = v_scenario;
  end if;
  if sv.id is null then perform app_private.fail('invalid_scenario', 'Unknown scenario.'); end if;
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

-- ---------------------------------------------------------------- session JSON: limits and pause
create or replace function app_private.session_json(p_session uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id, 'repId', s.rep_id, 'repName', coalesce(pr.display_name, 'Rep'), 'kind', s.kind,
    'scenarioKey', sv.scenario_key, 'scenarioTitle', sv.title, 'drillKey', s.drill_key, 'parentSessionId', s.parent_session_id,
    'campaignVersion', cv.version, 'campaignName', cv.pack ->> 'name', 'rubricVersion', rv.version, 'mode', s.mode,
    'status', s.status, 'evaluationStatus', s.evaluation_status, 'startedAt', s.started_at, 'deadlineAt', s.deadline_at,
    'endedAt', s.ended_at, 'endReason', s.end_reason, 'transcriptRevision', s.transcript_revision, 'usedSeconds', s.used_seconds,
    'maxSeconds', s.max_seconds, 'maxRepTurns', s.max_rep_turns, 'pausedSeconds', s.paused_seconds,
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

-- Internal helpers: only called from the functions above (which run as the owner).
revoke all on function app_private.pause_credit(public.sessions), app_private.resume_clock(uuid) from public, anon, authenticated, service_role;
