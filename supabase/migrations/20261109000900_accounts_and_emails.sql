-- Accounts and emails (DECISIONS D37):
--   1. Practice allowances renew by themselves (agencies.renew_allowance_seconds / renew_period_days).
--   2. People can change their display name; managers can change retention and email notifications.
--   3. A signed-in person with no team can start a free pilot (service-only, capped).
--   4. Manager emails: flagged-session alerts and a weekly summary are claimed here, sent by the server.
--
-- Backwards compatible: new columns have defaults, new functions only, and the two replaced
-- functions (my_context, bootstrap_agency) keep their signatures and existing output.

alter table public.agencies
  add column if not exists renew_allowance_seconds int check (renew_allowance_seconds is null or renew_allowance_seconds between 60 and 6000000),
  add column if not exists renew_period_days int not null default 30 check (renew_period_days between 1 and 366),
  add column if not exists email_notifications boolean not null default true,
  add column if not exists flag_notified_at timestamptz not null default now(),
  add column if not exists digest_sent_at timestamptz not null default now();

-- Existing teams keep getting the allowance they have now, every 30 days.
update public.agencies a set renew_allowance_seconds = greatest(60, u.allowance_seconds)
  from (select distinct on (agency_id) agency_id, allowance_seconds from public.usage_periods order by agency_id, starts_at desc) u
 where u.agency_id = a.id and a.renew_allowance_seconds is null;

-- ---------------------------------------------------------------- 1. allowance renewal
/** Creates the next usage period for teams whose current one is about to end. Called by maintenance. Idempotent. */
create or replace function app_api.renew_allowances(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; v_last timestamptz; v_start timestamptz; n int := 0;
begin
  for a in select id, renew_allowance_seconds, renew_period_days from public.agencies
            where status = 'active' and renew_allowance_seconds is not null for update
  loop
    select max(ends_at) into v_last from public.usage_periods where agency_id = a.id;
    -- Prepared up to an hour ahead so there is never a gap between periods.
    if v_last is null or v_last <= now() + interval '1 hour' then
      v_start := greatest(coalesce(v_last, now()), now());
      insert into public.usage_periods(agency_id, starts_at, ends_at, allowance_seconds)
        values (a.id, v_start, v_start + make_interval(days => a.renew_period_days), a.renew_allowance_seconds);
      insert into public.audit_events(agency_id, actor_id, action, metadata)
        values (a.id, null, 'allowance_renewed', jsonb_build_object('seconds', a.renew_allowance_seconds, 'days', a.renew_period_days));
      n := n + 1;
    end if;
  end loop;
  return jsonb_build_object('allowances_renewed', n);
end $$;

-- ---------------------------------------------------------------- 2. profile and team settings
create or replace function app_api.update_profile(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_name text := btrim(regexp_replace(coalesce(p ->> 'display_name', ''), '\s+', ' ', 'g'));
begin
  if v_user is null then perform app_private.fail('forbidden', 'Please sign in.'); end if;
  if length(v_name) not between 1 and 80 then perform app_private.fail('invalid_input', 'Your name must be 1–80 characters.'); end if;
  insert into public.profiles(user_id, display_name) values (v_user, v_name)
    on conflict (user_id) do update set display_name = excluded.display_name;
  return jsonb_build_object('displayName', v_name);
end $$;

create or replace function app_api.update_agency_settings(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.memberships; v_days int; v_emails boolean; a public.agencies;
begin
  m := app_private.require_manager();
  v_days := nullif(p ->> 'retention_days', '')::int;
  v_emails := nullif(p ->> 'email_notifications', '')::boolean;
  if v_days is not null and v_days not between 1 and 365 then perform app_private.fail('invalid_input', 'Keep data for between 1 and 365 days.'); end if;
  update public.agencies set
    retention_days = coalesce(v_days, retention_days),
    email_notifications = coalesce(v_emails, email_notifications)
  where id = m.agency_id returning * into a;
  perform app_private.audit(m.agency_id, 'agency_settings_updated', 'agency', m.agency_id::text,
    jsonb_build_object('retention_days', a.retention_days, 'email_notifications', a.email_notifications));
  return jsonb_build_object('retentionDays', a.retention_days, 'emailNotifications', a.email_notifications);
end $$;

create or replace function app_api.my_context() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'membership', (select jsonb_build_object('agencyId', m.agency_id, 'role', m.role, 'active', m.active) from public.memberships m where m.user_id = (select auth.uid())),
    'profile', (select jsonb_build_object('displayName', p.display_name) from public.profiles p where p.user_id = (select auth.uid())),
    'agency', (select jsonb_build_object('name', a.name, 'retentionDays', a.retention_days, 'emailNotifications', a.email_notifications) from public.agencies a limit 1),
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

-- ---------------------------------------------------------------- 3. bootstrap + self-serve pilot
create or replace function app_private.bootstrap_agency(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_agency uuid; v_user uuid; v_rubric uuid; s jsonb; v_allow int := coalesce((p ->> 'allowance_seconds')::int, 9000); v_days int := coalesce((p ->> 'period_days')::int, 14);
begin
  select id into v_user from auth.users where lower(email) = lower(p ->> 'manager_email');
  if v_user is null then perform app_private.fail('manager_not_found', 'Create the manager''s auth account first (sign up), then re-run.'); end if;
  if exists (select 1 from public.memberships where user_id = v_user) then perform app_private.fail('already_member', 'That user already belongs to an agency.'); end if;
  -- Allowances renew unless the payload says "renew": false (free pilots).
  insert into public.agencies(name, retention_days, seat_limit, renew_allowance_seconds, renew_period_days)
    values (p ->> 'agency_name', coalesce((p ->> 'retention_days')::int, 30), coalesce((p ->> 'seat_limit')::int, 5),
            case when coalesce((p ->> 'renew')::boolean, true) then greatest(60, v_allow) end, coalesce((p ->> 'renew_period_days')::int, 30))
    returning id into v_agency;
  insert into public.memberships(agency_id, user_id, role) values (v_agency, v_user, 'manager');
  insert into public.profiles(user_id, display_name) values (v_user, coalesce(nullif(btrim(p ->> 'manager_name'), ''), split_part(p ->> 'manager_email', '@', 1)))
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
    values (v_agency, now(), now() + make_interval(days => v_days), v_allow);
  insert into public.audit_events(agency_id, actor_id, action, target_type, target_id) values (v_agency, v_user, 'agency_bootstrapped', 'agency', v_agency::text);
  return v_agency;
end $$;

/**
 * Free pilot for a signed-in person who has confirmed their email and isn't in a team yet.
 * Service-only: the server passes the verified user ID and the starter content. One free pilot per
 * person, a daily cap across the whole service, a small allowance that does not renew.
 */
create or replace function app_api.create_pilot_agency(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (p ->> 'user_id')::uuid; v_email text; v_confirmed timestamptz; v_name text := btrim(coalesce(p ->> 'agency_name', '')); v_agency uuid;
begin
  select email, email_confirmed_at into v_email, v_confirmed from auth.users where id = v_user;
  if v_email is null then perform app_private.fail('forbidden', 'Please sign in.'); end if;
  if v_confirmed is null then perform app_private.fail('email_unconfirmed', 'Confirm your email address first.'); end if;
  if length(v_name) not between 2 and 120 then perform app_private.fail('invalid_input', 'Give your team a name (2–120 characters).'); end if;
  if exists (select 1 from public.memberships where user_id = v_user) then perform app_private.fail('already_member', 'You already belong to a team.'); end if;
  if exists (select 1 from public.audit_events where actor_id = v_user and action = 'pilot_started') then
    perform app_private.fail('pilot_used', 'You have already had a free pilot. Contact us to carry on.');
  end if;
  if (select count(*) from public.audit_events where action = 'pilot_started' and created_at > now() - interval '24 hours') >= coalesce((p ->> 'daily_cap')::int, 20) then
    perform app_private.fail('rate_limited', 'We''ve reached today''s limit for new pilots. Please try again tomorrow or contact us.');
  end if;
  v_agency := app_private.bootstrap_agency((p -> 'payload') || jsonb_build_object(
    'agency_name', v_name, 'manager_email', v_email, 'manager_name', nullif(btrim(coalesce(p ->> 'manager_name', '')), ''), 'renew', false));
  -- agency_id is left null so the record survives if the team is later deleted (one pilot per person).
  insert into public.audit_events(agency_id, actor_id, action, target_type, target_id) values (null, v_user, 'pilot_started', 'agency', v_agency::text);
  return jsonb_build_object('agencyId', v_agency);
end $$;

-- ---------------------------------------------------------------- 4. manager emails
/**
 * Hands the server what to email managers, and marks it as handed over so nothing is sent twice:
 * sessions newly flagged since the last alert, and (once a week) a summary of the last 7 days.
 */
create or replace function app_api.claim_manager_notifications(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.agencies; v_out jsonb := '[]'::jsonb; v_managers jsonb; v_flagged jsonb; v_digest jsonb; v_sessions int;
begin
  for a in select * from public.agencies where status = 'active' and email_notifications for update loop
    select coalesce(jsonb_agg(u.email order by u.email), '[]'::jsonb) into v_managers
      from public.memberships m join auth.users u on u.id = m.user_id
     where m.agency_id = a.id and m.role = 'manager' and m.active and u.email_confirmed_at is not null;

    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_flagged from (
      select jsonb_build_object('sessionId', s.id, 'repName', coalesce(pr.display_name, 'Rep'), 'scenarioTitle', sv.title,
                                'concerns', jsonb_array_length(e.result -> 'concerns')) x
        from public.sessions s
        join public.scenario_versions sv on sv.id = s.scenario_version_id
        left join public.profiles pr on pr.user_id = s.rep_id
        join lateral (select ev.result, ev.created_at from public.evaluations ev
                       where ev.session_id = s.id and ev.status = 'completed' order by ev.transcript_revision desc, ev.created_at desc limit 1) e on true
       where s.agency_id = a.id and e.created_at > a.flag_notified_at and jsonb_array_length(coalesce(e.result -> 'concerns', '[]'::jsonb)) > 0
       order by e.created_at limit 20) q;

    v_digest := null;
    if a.digest_sent_at <= now() - interval '7 days' then
      select count(*) into v_sessions from public.sessions s where s.agency_id = a.id and s.status = 'ended' and s.ended_at > now() - interval '7 days';
      if v_sessions > 0 then
        select jsonb_build_object(
          'sessions', v_sessions,
          'reps', (select count(distinct s.rep_id) from public.sessions s where s.agency_id = a.id and s.status = 'ended' and s.ended_at > now() - interval '7 days'),
          'activeReps', (select count(*) from public.memberships m where m.agency_id = a.id and m.role = 'rep' and m.active),
          'averageScore', (select round(avg((d ->> 'score')::numeric), 1)
                             from public.sessions s
                             join lateral (select ev.result from public.evaluations ev where ev.session_id = s.id and ev.status = 'completed'
                                            order by ev.transcript_revision desc, ev.created_at desc limit 1) e on true,
                             jsonb_array_elements(e.result -> 'dimensions') d
                            where s.agency_id = a.id and s.ended_at > now() - interval '7 days' and d ->> 'score' is not null),
          'flagged', (select count(*) from public.sessions s
                       join lateral (select ev.result from public.evaluations ev where ev.session_id = s.id and ev.status = 'completed'
                                      order by ev.transcript_revision desc, ev.created_at desc limit 1) e on true
                      where s.agency_id = a.id and s.ended_at > now() - interval '7 days' and jsonb_array_length(coalesce(e.result -> 'concerns', '[]'::jsonb)) > 0)
        ) into v_digest;
      end if;
      update public.agencies set digest_sent_at = now() where id = a.id;
    end if;
    update public.agencies set flag_notified_at = now() where id = a.id;

    if jsonb_array_length(v_managers) > 0 and (jsonb_array_length(v_flagged) > 0 or v_digest is not null) then
      v_out := v_out || jsonb_build_object('agencyName', a.name, 'managers', v_managers, 'flagged', v_flagged, 'digest', v_digest);
    end if;
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function app_api.renew_allowances(jsonb), app_api.update_profile(jsonb), app_api.update_agency_settings(jsonb),
  app_api.create_pilot_agency(jsonb), app_api.claim_manager_notifications(jsonb), app_private.bootstrap_agency(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function app_api.update_profile(jsonb), app_api.update_agency_settings(jsonb), app_api.my_context() to authenticated;
grant execute on function app_api.renew_allowances(jsonb), app_api.create_pilot_agency(jsonb), app_api.claim_manager_notifications(jsonb) to service_role;
