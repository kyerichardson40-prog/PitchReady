-- Row Level Security. Clients get SELECT only, filtered by policy. Every write goes through
-- app_api functions that re-check identity (auth.uid()) and membership explicitly.
-- Helpers live in app_private (NOT exposed through the Data API), are SECURITY DEFINER with an
-- empty search_path, and avoid recursive policies on memberships.

create or replace function app_private.my_role(p_agency uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.memberships m
  join public.agencies a on a.id = m.agency_id and a.status = 'active'
  where m.agency_id = p_agency and m.user_id = (select auth.uid()) and m.active
$$;

create or replace function app_private.is_member(p_agency uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app_private.my_role(p_agency) is not null
$$;

create or replace function app_private.is_manager(p_agency uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app_private.my_role(p_agency) = 'manager', false)
$$;

create or replace function app_private.can_read_session(p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.sessions s
    where s.id = p_session
      and (app_private.is_manager(s.agency_id) or (s.rep_id = (select auth.uid()) and app_private.is_member(s.agency_id)))
  )
$$;

revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to authenticated; -- needed to evaluate policy expressions
revoke all on all functions in schema app_private from public, anon, authenticated, service_role;
grant execute on function app_private.my_role(uuid), app_private.is_member(uuid), app_private.is_manager(uuid), app_private.can_read_session(uuid) to authenticated;

-- ---------------------------------------------------------------- enable RLS everywhere
do $$
declare t text;
begin
  foreach t in array array['agencies','profiles','memberships','invitations','rubric_versions','campaign_versions','scenario_versions',
    'sessions','turns','turn_corrections','evaluation_jobs','evaluations','feedback_reports','manager_reviews','usage_periods',
    'usage_ledger','provider_attempts','audit_events','deletion_requests']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- Read-only grants for signed-in users; RLS decides which rows.
grant select on public.agencies, public.profiles, public.memberships, public.invitations, public.rubric_versions,
  public.campaign_versions, public.scenario_versions, public.sessions, public.turns, public.turn_corrections,
  public.evaluations, public.feedback_reports, public.manager_reviews, public.usage_periods, public.usage_ledger,
  public.provider_attempts, public.audit_events, public.deletion_requests to authenticated;
-- evaluation_jobs: no client access at all.

create policy agencies_member_read on public.agencies for select to authenticated using (app_private.is_member(id));

create policy profiles_read on public.profiles for select to authenticated using (
  user_id = (select auth.uid())
  or exists (select 1 from public.memberships m where m.user_id = profiles.user_id and app_private.is_manager(m.agency_id))
);

create policy memberships_read on public.memberships for select to authenticated using (
  (user_id = (select auth.uid())) or app_private.is_manager(agency_id)
);

create policy invitations_manager_read on public.invitations for select to authenticated using (app_private.is_manager(agency_id));

create policy rubric_member_read on public.rubric_versions for select to authenticated using (app_private.is_member(agency_id));
create policy scenario_member_read on public.scenario_versions for select to authenticated using (app_private.is_member(agency_id));
create policy campaign_read on public.campaign_versions for select to authenticated using (
  (state = 'published' and app_private.is_member(agency_id)) or app_private.is_manager(agency_id)
);

create policy sessions_read on public.sessions for select to authenticated using (
  app_private.is_manager(agency_id) or (rep_id = (select auth.uid()) and app_private.is_member(agency_id))
);
create policy turns_read on public.turns for select to authenticated using (app_private.can_read_session(session_id));
create policy corrections_read on public.turn_corrections for select to authenticated using (app_private.can_read_session(session_id));
create policy evaluations_read on public.evaluations for select to authenticated using (app_private.can_read_session(session_id));
create policy reports_read on public.feedback_reports for select to authenticated using (
  app_private.is_manager(agency_id) or (reporter_id = (select auth.uid()) and app_private.is_member(agency_id))
);
create policy reviews_manager_read on public.manager_reviews for select to authenticated using (app_private.is_manager(agency_id));
create policy usage_member_read on public.usage_periods for select to authenticated using (app_private.is_member(agency_id));
create policy ledger_manager_read on public.usage_ledger for select to authenticated using (app_private.is_manager(agency_id));
create policy attempts_manager_read on public.provider_attempts for select to authenticated using (app_private.is_manager(agency_id));
create policy audit_manager_read on public.audit_events for select to authenticated using (app_private.is_manager(agency_id));
create policy deletion_read on public.deletion_requests for select to authenticated using (
  app_private.is_manager(agency_id) or (user_id = (select auth.uid()) and app_private.is_member(agency_id))
);
