-- Owner suite (DECISIONS D39): one place for the site owner to run PitchReady.
--
-- Every function here is callable by the service role only. The server decides who the owner is
-- (OWNER_EMAILS, a confirmed sign-in) and passes the owner's user ID as actor_id for the audit log.
-- Nothing here is reachable with a normal user's token.
--
-- Backwards compatible: one new table, one new trigger (inactive until practice is paused), new functions.

-- ---------------------------------------------------------------- site-wide settings
create table if not exists public.site_settings (
  id boolean primary key default true check (id),
  pilots_enabled boolean not null default true,
  pilot_seconds int not null default 3600 check (pilot_seconds between 60 and 360000),
  pilot_days int not null default 14 check (pilot_days between 1 and 90),
  pilot_daily_cap int not null default 20 check (pilot_daily_cap between 0 and 1000),
  practice_paused boolean not null default false,
  practice_paused_message text check (practice_paused_message is null or length(practice_paused_message) <= 300),
  voice_enabled boolean not null default true,
  announcement text check (announcement is null or length(announcement) <= 300),
  announcement_tone text not null default 'info' check (announcement_tone in ('info', 'warn')),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.site_settings(id) values (true) on conflict do nothing;
alter table public.site_settings enable row level security;
revoke all on public.site_settings from anon, authenticated;

create or replace function app_private.settings_json(s public.site_settings) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('pilotsEnabled', s.pilots_enabled, 'pilotSeconds', s.pilot_seconds, 'pilotDays', s.pilot_days,
    'pilotDailyCap', s.pilot_daily_cap, 'practicePaused', s.practice_paused, 'practicePausedMessage', s.practice_paused_message,
    'voiceEnabled', s.voice_enabled, 'announcement', s.announcement, 'announcementTone', s.announcement_tone, 'updatedAt', s.updated_at)
$$;

/** Read by the server for every visitor (announcement, pilots, voice, pause). */
create or replace function app_api.site_settings(p jsonb default '{}'::jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.settings_json(s) from public.site_settings s where s.id
$$;

-- Pausing practice is enforced by the database: no new session can be created while it is on.
create or replace function app_private.block_when_paused() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.site_settings;
begin
  select * into s from public.site_settings where id;
  if found and s.practice_paused then
    perform app_private.fail('practice_paused', coalesce(nullif(s.practice_paused_message, ''), 'Practice is paused for a short while. Please try again later.'));
  end if;
  return new;
end $$;
drop trigger if exists sessions_block_when_paused on public.sessions;
create trigger sessions_block_when_paused before insert on public.sessions for each row execute function app_private.block_when_paused();

create or replace function app_private.owner_audit(p_actor uuid, p_agency uuid, p_action text, p_target_type text, p_target_id text, p_meta jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_events(agency_id, actor_id, action, target_type, target_id, metadata)
  values (p_agency, p_actor, p_action, p_target_type, p_target_id, coalesce(p_meta, '{}'::jsonb));
$$;

create or replace function app_api.owner_update_settings(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.site_settings; v_actor uuid := (p ->> 'actor_id')::uuid;
begin
  update public.site_settings set
    pilots_enabled = coalesce((p ->> 'pilotsEnabled')::boolean, pilots_enabled),
    pilot_seconds = coalesce((p ->> 'pilotSeconds')::int, pilot_seconds),
    pilot_days = coalesce((p ->> 'pilotDays')::int, pilot_days),
    pilot_daily_cap = coalesce((p ->> 'pilotDailyCap')::int, pilot_daily_cap),
    practice_paused = coalesce((p ->> 'practicePaused')::boolean, practice_paused),
    practice_paused_message = case when p ? 'practicePausedMessage' then nullif(btrim(p ->> 'practicePausedMessage'), '') else practice_paused_message end,
    voice_enabled = coalesce((p ->> 'voiceEnabled')::boolean, voice_enabled),
    announcement = case when p ? 'announcement' then nullif(btrim(p ->> 'announcement'), '') else announcement end,
    announcement_tone = coalesce(p ->> 'announcementTone', announcement_tone),
    updated_at = now(), updated_by = v_actor
  where id returning * into s;
  perform app_private.owner_audit(v_actor, null, 'owner_settings_updated', 'site', 'settings', p - 'actor_id');
  return app_private.settings_json(s);
end $$;

-- ---------------------------------------------------------------- overview
create or replace function app_api.owner_overview(p jsonb default '{}'::jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'teams', (select count(*) from public.agencies),
    'activeTeams', (select count(*) from public.agencies where status = 'active'),
    'pilots', (select count(*) from public.audit_events where action = 'pilot_started'),
    'pilotsLast7Days', (select count(*) from public.audit_events where action = 'pilot_started' and created_at > now() - interval '7 days'),
    'users', (select count(*) from auth.users),
    'usersLast7Days', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'usersWithoutTeam', (select count(*) from auth.users u where not exists (select 1 from public.memberships m where m.user_id = u.id)),
    'activeReps', (select count(*) from public.memberships where role = 'rep' and active),
    'managers', (select count(*) from public.memberships where role = 'manager' and active),
    'sessionsLast7Days', (select count(*) from public.sessions where created_at > now() - interval '7 days'),
    'sessionsLast30Days', (select count(*) from public.sessions where created_at > now() - interval '30 days'),
    'minutesLast30Days', (select round(coalesce(sum(used_seconds), 0) / 60.0, 1) from public.sessions where ended_at > now() - interval '30 days'),
    'aiSpendMinorThisPeriod', (select coalesce(sum(spend_actual_minor), 0) from public.usage_periods where starts_at <= now() and ends_at > now()),
    'activeSessions', (select count(*) from public.sessions where status in ('created', 'active', 'ending')),
    'newMessages', (select count(*) from public.contact_messages where status = 'new'),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'sessions', n) order by d), '[]'::jsonb) from (
               select g d, (select count(*) from public.sessions s where s.created_at >= g and s.created_at < g + interval '1 day') n
               from generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') g) q),
    'settings', (select app_private.settings_json(s) from public.site_settings s where s.id)
  )
$$;

-- ---------------------------------------------------------------- teams
create or replace function app_private.owner_team_row(a public.agencies) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', a.id, 'name', a.name, 'status', a.status, 'createdAt', a.created_at, 'seatLimit', a.seat_limit, 'retentionDays', a.retention_days,
    'renewAllowanceSeconds', a.renew_allowance_seconds, 'renewPeriodDays', a.renew_period_days, 'emailNotifications', a.email_notifications,
    'isPilot', exists (select 1 from public.audit_events e where e.action = 'pilot_started' and e.target_id = a.id::text),
    'managers', (select count(*) from public.memberships m where m.agency_id = a.id and m.role = 'manager' and m.active),
    'reps', (select count(*) from public.memberships m where m.agency_id = a.id and m.role = 'rep' and m.active),
    'inactiveMembers', (select count(*) from public.memberships m where m.agency_id = a.id and not m.active),
    'pendingInvites', (select count(*) from public.invitations i where i.agency_id = a.id and i.used_at is null and i.revoked_at is null and i.expires_at > now()),
    'managerEmails', (select coalesce(jsonb_agg(u.email order by u.email), '[]'::jsonb) from public.memberships m join auth.users u on u.id = m.user_id
                       where m.agency_id = a.id and m.role = 'manager' and m.active),
    'period', (select jsonb_build_object('id', u.id, 'startsAt', u.starts_at, 'endsAt', u.ends_at, 'allowanceSeconds', u.allowance_seconds,
                 'consumedSeconds', u.consumed_seconds, 'reservedSeconds', u.reserved_seconds, 'spendMinor', u.spend_actual_minor)
               from public.usage_periods u where u.agency_id = a.id and u.starts_at <= now() and u.ends_at > now() order by u.starts_at desc limit 1),
    'nextPeriod', (select jsonb_build_object('startsAt', u.starts_at, 'allowanceSeconds', u.allowance_seconds)
                   from public.usage_periods u where u.agency_id = a.id and u.starts_at > now() order by u.starts_at limit 1),
    'sessionsLast30Days', (select count(*) from public.sessions s where s.agency_id = a.id and s.created_at > now() - interval '30 days'),
    'lastActivity', (select max(s.created_at) from public.sessions s where s.agency_id = a.id)
  )
$$;

create or replace function app_api.owner_list_teams(p jsonb default '{}'::jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(app_private.owner_team_row(a) order by a.created_at desc), '[]'::jsonb) from public.agencies a
$$;

create or replace function app_api.owner_team_detail(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a public.agencies;
begin
  select * into a from public.agencies where id = (p ->> 'agency_id')::uuid;
  if not found then perform app_private.fail('not_found', 'Team not found.'); end if;
  return app_private.owner_team_row(a) || jsonb_build_object(
    'members', (select coalesce(jsonb_agg(jsonb_build_object('userId', m.user_id, 'email', u.email, 'name', pr.display_name, 'role', m.role, 'active', m.active,
                  'joinedAt', m.created_at, 'lastSignInAt', u.last_sign_in_at,
                  'sessions', (select count(*) from public.sessions s where s.agency_id = a.id and s.rep_id = m.user_id)) order by m.role, lower(coalesce(pr.display_name, u.email))), '[]'::jsonb)
                from public.memberships m join auth.users u on u.id = m.user_id left join public.profiles pr on pr.user_id = m.user_id where m.agency_id = a.id),
    'invitations', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'role', i.role, 'expiresAt', i.expires_at, 'createdAt', i.created_at) order by i.created_at desc), '[]'::jsonb)
                    from public.invitations i where i.agency_id = a.id and i.used_at is null and i.revoked_at is null and i.expires_at > now()),
    'periods', (select coalesce(jsonb_agg(x order by x ->> 'startsAt' desc), '[]'::jsonb) from (
                  select jsonb_build_object('id', u.id, 'startsAt', u.starts_at, 'endsAt', u.ends_at, 'allowanceSeconds', u.allowance_seconds,
                    'consumedSeconds', u.consumed_seconds, 'reservedSeconds', u.reserved_seconds, 'spendMinor', u.spend_actual_minor) x
                  from public.usage_periods u where u.agency_id = a.id order by u.starts_at desc limit 8) q),
    'campaign', (select jsonb_build_object('name', c.pack ->> 'name', 'version', c.version, 'channel', c.pack -> 'sales_context' ->> 'channel', 'practiceMinutes', c.pack -> 'practice_minutes')
                 from public.campaign_versions c where c.agency_id = a.id and c.state = 'published' order by c.version desc limit 1),
    'activity', (select coalesce(jsonb_agg(x order by (x ->> 'at') desc), '[]'::jsonb) from (
                   select jsonb_build_object('at', e.created_at, 'action', e.action, 'actor', coalesce(u.email, 'system'), 'targetType', e.target_type) x
                   from public.audit_events e left join auth.users u on u.id = e.actor_id
                   where e.agency_id = a.id order by e.created_at desc limit 25) q)
  );
end $$;

create or replace function app_api.owner_update_team(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.agencies; v_actor uuid := (p ->> 'actor_id')::uuid; v_id uuid := (p ->> 'agency_id')::uuid;
begin
  if p ? 'name' and length(btrim(p ->> 'name')) not between 1 and 120 then perform app_private.fail('invalid_input', 'Team name must be 1–120 characters.'); end if;
  if p ? 'status' and p ->> 'status' not in ('active', 'suspended') then perform app_private.fail('invalid_input', 'Bad status.'); end if;
  update public.agencies set
    name = coalesce(btrim(p ->> 'name'), name),
    status = coalesce(p ->> 'status', status),
    seat_limit = coalesce((p ->> 'seatLimit')::int, seat_limit),
    retention_days = coalesce((p ->> 'retentionDays')::int, retention_days),
    renew_allowance_seconds = case when p ? 'renewAllowanceSeconds' then (p ->> 'renewAllowanceSeconds')::int else renew_allowance_seconds end,
    renew_period_days = coalesce((p ->> 'renewPeriodDays')::int, renew_period_days),
    email_notifications = coalesce((p ->> 'emailNotifications')::boolean, email_notifications)
  where id = v_id returning * into a;
  if not found then perform app_private.fail('not_found', 'Team not found.'); end if;
  -- Suspending a team ends any practice in progress (charged as usual).
  if a.status = 'suspended' then
    perform app_private.close_session(s.id, case when exists (select 1 from public.turns t where t.session_id = s.id and t.speaker = 'rep') then 'rep_ended' else 'abandoned' end)
      from public.sessions s where s.agency_id = a.id and s.status in ('created', 'active', 'ending');
  end if;
  perform app_private.owner_audit(v_actor, a.id, 'owner_team_updated', 'agency', a.id::text, p - 'actor_id' - 'agency_id');
  return app_private.owner_team_row(a);
end $$;

/**
 * Practice time for the current period: add (or take away) minutes, or start a new period now
 * when the team has none (or `new_period` is set). Never below what is already used or reserved.
 */
create or replace function app_api.owner_adjust_allowance(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.agencies; u public.usage_periods; v_actor uuid := (p ->> 'actor_id')::uuid; v_add int := coalesce((p ->> 'add_seconds')::int, 0);
        v_days int := coalesce((p ->> 'days')::int, 30); v_new boolean := coalesce((p ->> 'new_period')::boolean, false);
begin
  select * into a from public.agencies where id = (p ->> 'agency_id')::uuid for update;
  if not found then perform app_private.fail('not_found', 'Team not found.'); end if;
  select * into u from public.usage_periods where agency_id = a.id and starts_at <= now() and ends_at > now() order by starts_at desc limit 1 for update;
  if v_new or not found then
    if v_add <= 0 then perform app_private.fail('invalid_input', 'A new period needs some practice time.'); end if;
    if v_days not between 1 and 366 then perform app_private.fail('invalid_input', 'A period is 1–366 days.'); end if;
    -- The current period (if any) ends now; anything still reserved settles into it as usual.
    update public.usage_periods set ends_at = now() where id = u.id and u.id is not null;
    update public.usage_periods set starts_at = now() + make_interval(days => v_days), ends_at = ends_at + make_interval(days => v_days)
     where agency_id = a.id and starts_at > now(); -- push any prepared renewal back behind the new period
    insert into public.usage_periods(agency_id, starts_at, ends_at, allowance_seconds) values (a.id, now(), now() + make_interval(days => v_days), v_add) returning * into u;
  else
    if u.allowance_seconds + v_add < u.consumed_seconds + u.reserved_seconds then
      perform app_private.fail('invalid_input', format('That would leave less than the %s minutes already used or in progress.', ceil((u.consumed_seconds + u.reserved_seconds) / 60.0)));
    end if;
    update public.usage_periods set allowance_seconds = allowance_seconds + v_add where id = u.id returning * into u;
  end if;
  perform app_private.owner_audit(v_actor, a.id, 'owner_allowance_adjusted', 'usage_period', u.id::text,
    jsonb_build_object('add_seconds', v_add, 'new_period', v_new, 'days', v_days, 'allowance_seconds', u.allowance_seconds));
  return app_private.owner_team_row(a);
end $$;

/**
 * Create a team. If the manager already has an account (and no team) they become its manager now;
 * otherwise an invitation is stored for them (the server makes the token and returns the link).
 */
create or replace function app_api.owner_create_team(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p ->> 'actor_id')::uuid; v_email text := lower(btrim(p ->> 'manager_email')); v_user uuid; v_agency uuid; v_rubric uuid; s jsonb;
        v_name text := btrim(coalesce(p ->> 'agency_name', '')); v_allow int := coalesce((p ->> 'allowance_seconds')::int, 9000);
        v_days int := coalesce((p ->> 'period_days')::int, 30); v_renew boolean := coalesce((p ->> 'renew')::boolean, true); v_payload jsonb := p -> 'payload';
begin
  if length(v_name) not between 1 and 120 then perform app_private.fail('invalid_input', 'Team name must be 1–120 characters.'); end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform app_private.fail('invalid_input', 'Enter the manager''s email address.'); end if;
  if v_allow not between 60 and 6000000 or v_days not between 1 and 366 then perform app_private.fail('invalid_input', 'Check the practice time and period length.'); end if;
  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null and exists (select 1 from public.memberships where user_id = v_user) then
    perform app_private.fail('already_member', 'That person already belongs to a team. Remove them from it first.');
  end if;

  insert into public.agencies(name, retention_days, seat_limit, renew_allowance_seconds, renew_period_days)
    values (v_name, coalesce((p ->> 'retention_days')::int, 30), coalesce((p ->> 'seat_limit')::int, 5), case when v_renew then v_allow end, v_days)
    returning id into v_agency;
  insert into public.rubric_versions(agency_id, version, dimensions, prompt_version, approved_by, approved_at)
    values (v_agency, v_payload -> 'rubric' ->> 'version', v_payload -> 'rubric' -> 'dimensions', v_payload -> 'rubric' ->> 'prompt_version', v_actor, now()) returning id into v_rubric;
  insert into public.campaign_versions(agency_id, campaign_key, version, pack, rubric_version_id, state, approved_by, approved_at, created_by)
    values (v_agency, v_payload -> 'campaign' ->> 'campaign_key', 1, v_payload -> 'campaign', v_rubric, 'published', v_actor, now(), v_actor);
  for s in select * from jsonb_array_elements(v_payload -> 'scenarios') loop
    insert into public.scenario_versions(agency_id, scenario_key, version, title, persona, opener, objection, goal, allowed_ending, behaviour, skill)
      values (v_agency, s ->> 'key', 1, s ->> 'title', s ->> 'persona', s ->> 'opener', s ->> 'objection', s ->> 'goal', s ->> 'allowedEnding', s ->> 'behaviour', s ->> 'skill');
  end loop;
  insert into public.usage_periods(agency_id, starts_at, ends_at, allowance_seconds) values (v_agency, now(), now() + make_interval(days => v_days), v_allow);

  if v_user is not null then
    insert into public.memberships(agency_id, user_id, role) values (v_agency, v_user, 'manager');
    insert into public.profiles(user_id, display_name) values (v_user, coalesce(nullif(btrim(p ->> 'manager_name'), ''), split_part(v_email, '@', 1)))
      on conflict (user_id) do nothing;
  else
    insert into public.invitations(agency_id, email, role, token_hash, expires_at, invited_by)
      values (v_agency, v_email, 'manager', decode(p ->> 'token_hash_hex', 'hex'), now() + interval '14 days', v_actor);
  end if;
  perform app_private.owner_audit(v_actor, v_agency, 'owner_team_created', 'agency', v_agency::text,
    jsonb_build_object('manager_existing', v_user is not null, 'allowance_seconds', v_allow, 'days', v_days, 'renew', v_renew));
  return jsonb_build_object('agencyId', v_agency, 'managerAdded', v_user is not null);
end $$;

/** Deletes a team and everything in it. The exact team name must be given as confirmation. */
create or replace function app_api.owner_delete_team(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.agencies; v_actor uuid := (p ->> 'actor_id')::uuid;
begin
  select * into a from public.agencies where id = (p ->> 'agency_id')::uuid for update;
  if not found then perform app_private.fail('not_found', 'Team not found.'); end if;
  if coalesce(p ->> 'confirm_name', '') <> a.name then perform app_private.fail('invalid_input', 'Type the team''s name exactly to confirm.'); end if;
  -- Same permission the retention clean-up uses to remove otherwise permanent records.
  perform set_config('pitchready.retention', 'on', true);
  delete from public.sessions where agency_id = a.id; -- turns, feedback, notes etc. go with them
  delete from public.usage_ledger where agency_id = a.id;
  delete from public.agencies where id = a.id;      -- members, invitations, campaign, periods, audit
  perform app_private.owner_audit(v_actor, null, 'owner_team_deleted', 'agency', a.id::text, jsonb_build_object('name', a.name));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- users
create or replace function app_api.owner_list_users(p jsonb default '{}'::jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by (x ->> 'createdAt') desc), '[]'::jsonb) from (
    select jsonb_build_object('userId', u.id, 'email', u.email, 'name', pr.display_name, 'confirmed', u.email_confirmed_at is not null,
      'createdAt', u.created_at, 'lastSignInAt', u.last_sign_in_at, 'agencyId', m.agency_id, 'agencyName', a.name, 'agencyStatus', a.status,
      'role', m.role, 'active', m.active,
      'sessions', (select count(*) from public.sessions s where s.rep_id = u.id)) x
    from auth.users u
    left join public.memberships m on m.user_id = u.id
    left join public.agencies a on a.id = m.agency_id
    left join public.profiles pr on pr.user_id = u.id
    where coalesce(p ->> 'q', '') = '' or u.email ilike '%' || (p ->> 'q') || '%' or pr.display_name ilike '%' || (p ->> 'q') || '%' or a.name ilike '%' || (p ->> 'q') || '%'
    order by u.created_at desc limit 500) q
$$;

/**
 * Change someone's place in their team: role, active (access on/off), or remove them from the team.
 * Removing is only possible for people with no practice history (otherwise deactivate them; their
 * sessions are deleted with the team's normal retention).
 */
create or replace function app_api.owner_update_member(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.memberships; v_actor uuid := (p ->> 'actor_id')::uuid;
begin
  select * into m from public.memberships where user_id = (p ->> 'user_id')::uuid for update;
  if not found then perform app_private.fail('not_found', 'That person is not in a team.'); end if;
  if coalesce((p ->> 'remove')::boolean, false) then
    if exists (select 1 from public.sessions s where s.rep_id = m.user_id) or exists (select 1 from public.manager_reviews r where r.manager_id = m.user_id)
       or exists (select 1 from public.turn_corrections c where c.corrected_by = m.user_id) then
      perform app_private.fail('has_history', 'This person has practice or review history, so they can be deactivated but not removed.');
    end if;
    delete from public.memberships where user_id = m.user_id;
    perform app_private.owner_audit(v_actor, m.agency_id, 'owner_member_removed', 'user', m.user_id::text);
    return jsonb_build_object('ok', true);
  end if;
  if p ? 'role' and p ->> 'role' not in ('manager', 'rep') then perform app_private.fail('invalid_input', 'Bad role.'); end if;
  if p ? 'role' and p ->> 'role' = 'manager' and m.role = 'rep' and exists (select 1 from public.sessions s where s.rep_id = m.user_id and s.status in ('created', 'active', 'ending')) then
    perform app_private.fail('session_in_progress', 'They are in the middle of a practice. Try again in a few minutes.');
  end if;
  update public.memberships set
    role = coalesce(p ->> 'role', role),
    active = coalesce((p ->> 'active')::boolean, active),
    deactivated_at = case when (p ->> 'active')::boolean = false and active then now() when (p ->> 'active')::boolean then null else deactivated_at end
  where user_id = m.user_id returning * into m;
  perform app_private.owner_audit(v_actor, m.agency_id, 'owner_member_updated', 'user', m.user_id::text, p - 'actor_id' - 'user_id');
  return jsonb_build_object('ok', true, 'role', m.role, 'active', m.active);
end $$;

/** Whether an account can be deleted outright (no team, no history that refers to it). */
create or replace function app_api.owner_can_delete_user(p jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', not exists (select 1 from public.memberships where user_id = (p ->> 'user_id')::uuid)
    and not exists (select 1 from public.manager_reviews where manager_id = (p ->> 'user_id')::uuid)
    and not exists (select 1 from public.turn_corrections where corrected_by = (p ->> 'user_id')::uuid))
$$;

-- ---------------------------------------------------------------- messages and activity
create or replace function app_api.owner_list_messages(p jsonb default '{}'::jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by (x ->> 'createdAt') desc), '[]'::jsonb) from (
    select jsonb_build_object('id', c.id, 'name', c.name, 'email', c.email, 'company', c.company, 'teamSize', c.team_size,
      'salesType', c.sales_type, 'message', c.message, 'status', c.status, 'createdAt', c.created_at) x
    from public.contact_messages c
    where coalesce(p ->> 'status', 'open') = 'all' or (coalesce(p ->> 'status', 'open') = 'open' and c.status = 'new') or c.status = p ->> 'status'
    order by c.created_at desc limit 200) q
$$;

create or replace function app_api.owner_set_message_status(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p ->> 'status' not in ('new', 'replied', 'closed', 'spam') then perform app_private.fail('invalid_input', 'Bad status.'); end if;
  update public.contact_messages set status = p ->> 'status' where id = (p ->> 'id')::uuid;
  if not found then perform app_private.fail('not_found', 'Message not found.'); end if;
  perform app_private.owner_audit((p ->> 'actor_id')::uuid, null, 'owner_message_' || (p ->> 'status'), 'contact_message', p ->> 'id');
  return jsonb_build_object('ok', true);
end $$;

create or replace function app_api.owner_activity(p jsonb default '{}'::jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by (x ->> 'at') desc), '[]'::jsonb) from (
    select jsonb_build_object('at', e.created_at, 'action', e.action, 'actor', coalesce(u.email, 'system'), 'team', a.name,
      'targetType', e.target_type, 'metadata', e.metadata) x
    from public.audit_events e left join auth.users u on u.id = e.actor_id left join public.agencies a on a.id = e.agency_id
    where coalesce(p ->> 'owner_only', 'false') <> 'true' or e.action like 'owner_%'
    order by e.created_at desc limit 200) q
$$;

-- ---------------------------------------------------------------- grants: service role only
do $$
declare f text;
begin
  foreach f in array array[
    'app_api.site_settings(jsonb)', 'app_api.owner_update_settings(jsonb)', 'app_api.owner_overview(jsonb)', 'app_api.owner_list_teams(jsonb)',
    'app_api.owner_team_detail(jsonb)', 'app_api.owner_update_team(jsonb)', 'app_api.owner_adjust_allowance(jsonb)', 'app_api.owner_create_team(jsonb)',
    'app_api.owner_delete_team(jsonb)', 'app_api.owner_list_users(jsonb)', 'app_api.owner_update_member(jsonb)', 'app_api.owner_can_delete_user(jsonb)',
    'app_api.owner_list_messages(jsonb)', 'app_api.owner_set_message_status(jsonb)', 'app_api.owner_activity(jsonb)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
revoke all on function app_private.owner_audit(uuid, uuid, text, text, text, jsonb), app_private.owner_team_row(public.agencies),
  app_private.settings_json(public.site_settings), app_private.block_when_paused() from public, anon, authenticated, service_role;
