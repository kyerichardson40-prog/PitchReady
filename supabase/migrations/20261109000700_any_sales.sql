-- Any kind of sales (DECISIONS.md D30). Apply together with the app version that uses it.
--  * Retry drill openers are worded for any sales setting, not only charity doorsteps.
--  * A retry drill keeps the person (scenario version) of the session it retries, so drills work
--    for agencies whose scenarios came from a template rather than the built-in five.

create or replace function app_private.drill_opener(p_key text) returns text
language sql immutable set search_path = '' as $$
  -- Must match lib/content/scenarios.ts DRILLS (checked by tests/unit/drills.test.ts).
  select case p_key
    when 'already-donate' then 'I already have something like this, to be honest.'
    when 'busy' then 'I''m in a real rush, sorry.'
    when 'not-interested' then 'I''m not interested, thanks.'
    when 'cannot-afford' then 'Money''s tight at the moment, I can''t take on anything extra.'
    when 'prefers-one-off' then 'I''d rather not sign up to anything ongoing.'
    when 'legitimacy' then 'How do I know you''re legitimate?'
    when 'amount' then 'How much is this actually going to cost me?'
    when 'money-use' then 'What exactly would I be getting for that?'
    when 'cancellation' then 'And how would I cancel if I changed my mind?'
    when 'asks-to-end' then 'I''d like to end this here, please.'
  end
$$;

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

grant execute on function app_api.start_session(jsonb) to authenticated;
