-- Messages from the public contact form (DECISIONS.md D31). Written only by the server with the
-- secret key (rate-limited, spam trap); no client role can read or write. The owner reads them in
-- the Supabase dashboard (Table Editor → contact_messages).
create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  email text not null check (length(email) between 3 and 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  company text check (company is null or length(company) <= 160),
  team_size text check (team_size is null or length(team_size) <= 40),
  sales_type text check (sales_type is null or length(sales_type) <= 60),
  message text not null check (length(message) between 1 and 4000),
  status text not null default 'new' check (status in ('new', 'replied', 'closed', 'spam')),
  created_at timestamptz not null default now()
);
create index contact_messages_created_idx on public.contact_messages(created_at desc);
alter table public.contact_messages enable row level security;
revoke all on public.contact_messages from public, anon, authenticated;

create or replace function app_api.submit_contact(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  -- Global flood guard on top of the server's per-IP limit.
  if (select count(*) from public.contact_messages where created_at > now() - interval '1 hour') >= 60 then
    perform app_private.fail('rate_limited', 'Too many messages right now. Please try again later.');
  end if;
  insert into public.contact_messages(name, email, company, team_size, sales_type, message)
    values (btrim(p ->> 'name'), lower(btrim(p ->> 'email')), nullif(btrim(coalesce(p ->> 'company', '')), ''),
            nullif(btrim(coalesce(p ->> 'team_size', '')), ''), nullif(btrim(coalesce(p ->> 'sales_type', '')), ''), btrim(p ->> 'message'))
    returning id into v_id;
  return jsonb_build_object('id', v_id);
exception when check_violation or not_null_violation then
  perform app_private.fail('invalid_input', 'Please check the form and try again.');
end $$;
revoke all on function app_api.submit_contact(jsonb) from public, anon, authenticated, service_role;
grant execute on function app_api.submit_contact(jsonb) to service_role;

/** Retention for enquiries (privacy notice: 12 months). Called by the maintenance timer. */
create or replace function app_api.purge_contact_messages(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from public.contact_messages where created_at < now() - make_interval(months => coalesce((p ->> 'months')::int, 12));
  get diagnostics n = row_count;
  return jsonb_build_object('contact_messages_deleted', n);
end $$;
revoke all on function app_api.purge_contact_messages(jsonb) from public, anon, authenticated, service_role;
grant execute on function app_api.purge_contact_messages(jsonb) to service_role;
