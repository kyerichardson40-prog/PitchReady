-- Managers may see the sign-in email of members of THEIR OWN agency (they invited them).
create or replace function app_private.member_email(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select u.email from auth.users u
  where u.id = p_user
    and exists (select 1 from public.memberships m where m.user_id = p_user and app_private.is_manager(m.agency_id))
$$;
revoke all on function app_private.member_email(uuid) from public, anon, authenticated, service_role;
grant execute on function app_private.member_email(uuid) to authenticated;

create or replace function app_api.manager_roster() returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare m public.memberships;
begin
  select * into m from public.memberships where user_id = (select auth.uid()) and active and role = 'manager';
  if not found then perform app_private.fail('forbidden', 'Manager access required.'); end if;
  return jsonb_build_object(
    'seatLimit', (select seat_limit from public.agencies where id = m.agency_id),
    'members', coalesce((select jsonb_agg(jsonb_build_object('userId', x.user_id, 'name', coalesce(pr.display_name, 'Member'),
                 'email', coalesce(app_private.member_email(x.user_id), ''),
                 'role', x.role, 'active', x.active, 'sessions', (select count(*) from public.sessions s where s.rep_id = x.user_id and s.agency_id = m.agency_id)) order by x.created_at)
                 from public.memberships x left join public.profiles pr on pr.user_id = x.user_id where x.agency_id = m.agency_id), '[]'::jsonb),
    'invitations', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'role', i.role, 'createdAt', i.created_at, 'expiresAt', i.expires_at,
                 'usedAt', i.used_at, 'revokedAt', i.revoked_at) order by i.created_at desc)
                 from public.invitations i where i.agency_id = m.agency_id), '[]'::jsonb));
end $$;
grant execute on function app_api.manager_roster() to authenticated;
