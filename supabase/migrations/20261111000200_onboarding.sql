-- First-time questions (DECISIONS D40): what you or your team are struggling with, and what you
-- want PitchReady to help with. One row per person. Managers see their own team's answers; the
-- owner sees everyone's. Existing accounts are marked as done so only new people are asked.

create table if not exists public.onboarding_answers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text check (role in ('rep', 'manager')),
  struggles text[] not null default '{}' check (cardinality(struggles) <= 12),
  struggles_other text check (struggles_other is null or length(struggles_other) <= 500),
  goals text[] not null default '{}' check (cardinality(goals) <= 12),
  goals_other text check (goals_other is null or length(goals_other) <= 500),
  skipped boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.onboarding_answers enable row level security;
revoke all on public.onboarding_answers from anon, authenticated;

insert into public.onboarding_answers(user_id, skipped) select id, true from auth.users on conflict do nothing;

create or replace function app_api.my_onboarding(p jsonb default '{}'::jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('done', true, 'skipped', o.skipped, 'role', o.role, 'struggles', to_jsonb(o.struggles), 'goals', to_jsonb(o.goals))
                   from public.onboarding_answers o where o.user_id = (select auth.uid())), jsonb_build_object('done', false))
$$;

create or replace function app_api.save_onboarding(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_struggles text[]; v_goals text[];
begin
  if v_user is null then perform app_private.fail('forbidden', 'Please sign in.'); end if;
  if coalesce(p ->> 'role', 'rep') not in ('rep', 'manager') then perform app_private.fail('invalid_input', 'Bad role.'); end if;
  select coalesce(array_agg(distinct left(x, 40)), '{}') into v_struggles from jsonb_array_elements_text(coalesce(p -> 'struggles', '[]'::jsonb)) x;
  select coalesce(array_agg(distinct left(x, 40)), '{}') into v_goals from jsonb_array_elements_text(coalesce(p -> 'goals', '[]'::jsonb)) x;
  insert into public.onboarding_answers(user_id, role, struggles, struggles_other, goals, goals_other, skipped)
  values (v_user, p ->> 'role', v_struggles, nullif(left(btrim(p ->> 'struggles_other'), 500), ''), v_goals, nullif(left(btrim(p ->> 'goals_other'), 500), ''),
          coalesce((p ->> 'skipped')::boolean, false))
  on conflict (user_id) do update set role = excluded.role, struggles = excluded.struggles, struggles_other = excluded.struggles_other,
    goals = excluded.goals, goals_other = excluded.goals_other, skipped = excluded.skipped, updated_at = now();
  return jsonb_build_object('done', true);
end $$;

/** A manager's view: what the people in their team said (reps and other managers). */
create or replace function app_api.team_onboarding(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.memberships;
begin
  m := app_private.require_manager();
  return coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(pr.display_name, 'Team member'), 'role', o.role, 'struggles', to_jsonb(o.struggles),
            'strugglesOther', o.struggles_other, 'goals', to_jsonb(o.goals), 'goalsOther', o.goals_other, 'at', o.updated_at) order by o.updated_at desc)
    from public.onboarding_answers o join public.memberships mm on mm.user_id = o.user_id and mm.agency_id = m.agency_id and mm.active
    left join public.profiles pr on pr.user_id = o.user_id
    where not o.skipped and o.role is not null), '[]'::jsonb);
end $$;

/** The owner's view: everyone's answers, newest first. */
create or replace function app_api.owner_onboarding(p jsonb default '{}'::jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'answered', (select count(*) from public.onboarding_answers where not skipped and role is not null),
    -- People who were asked and chose "skip" (accounts from before onboarding have no role).
    'skipped', (select count(*) from public.onboarding_answers where skipped and role is not null),
    'responses', coalesce((select jsonb_agg(x order by (x ->> 'at') desc) from (
      select jsonb_build_object('email', u.email, 'name', pr.display_name, 'team', a.name, 'role', o.role, 'struggles', to_jsonb(o.struggles),
        'strugglesOther', o.struggles_other, 'goals', to_jsonb(o.goals), 'goalsOther', o.goals_other, 'at', o.updated_at) x
      from public.onboarding_answers o join auth.users u on u.id = o.user_id
      left join public.profiles pr on pr.user_id = o.user_id left join public.memberships m on m.user_id = o.user_id left join public.agencies a on a.id = m.agency_id
      where not o.skipped and o.role is not null order by o.updated_at desc limit 500) q), '[]'::jsonb)
  )
$$;

revoke all on function app_api.my_onboarding(jsonb), app_api.save_onboarding(jsonb), app_api.team_onboarding(jsonb), app_api.owner_onboarding(jsonb) from public, anon, authenticated, service_role;
grant execute on function app_api.my_onboarding(jsonb), app_api.save_onboarding(jsonb), app_api.team_onboarding(jsonb) to authenticated;
grant execute on function app_api.owner_onboarding(jsonb) to service_role;
