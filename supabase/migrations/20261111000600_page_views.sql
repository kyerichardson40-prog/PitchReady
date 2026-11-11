-- Site visits for the owner (DECISIONS D47). Cookie-free and anonymous: only daily totals per page and
-- per source website are kept; no IP address, user, device or cookie is stored.
create table if not exists public.page_views_daily (
  day date not null,
  path text not null check (length(path) between 1 and 120),
  source text not null default '' check (length(source) <= 80),
  views int not null default 0,
  entries int not null default 0,
  primary key (day, path, source)
);
alter table public.page_views_daily enable row level security;
revoke all on public.page_views_daily from anon, authenticated;

/** Server only: add one page view (entry = the first page of a visit, arriving from outside the site). */
create or replace function app_api.record_page_view(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_path text := left(coalesce(p ->> 'path', ''), 120); v_source text := left(coalesce(p ->> 'source', ''), 80);
        v_entry boolean := coalesce((p ->> 'entry')::boolean, false);
begin
  if v_path !~ '^/' then perform app_private.fail('invalid_input', 'Bad path.'); end if;
  insert into public.page_views_daily(day, path, source, views, entries)
    values ((now() at time zone 'Europe/London')::date, v_path, case when v_entry then v_source else '' end, 1, case when v_entry then 1 else 0 end)
    on conflict (day, path, source) do update set views = public.page_views_daily.views + 1,
      entries = public.page_views_daily.entries + excluded.entries;
  return jsonb_build_object('ok', true);
end $$;

/** Owner: visits over the last N days (UK dates), with top pages, sources, and sign-ups and pilots for context. */
create or replace function app_api.owner_visits(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_days int := least(greatest(coalesce((p ->> 'days')::int, 30), 1), 365);
        v_from date := (now() at time zone 'Europe/London')::date - (v_days - 1);
begin
  return jsonb_build_object(
    'days', v_days, 'from', v_from,
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', d.dt::date, 'views', coalesce(x.views, 0), 'visits', coalesce(x.entries, 0),
                 'signups', coalesce(su.n, 0)) order by d.dt)
               from generate_series(v_from, (now() at time zone 'Europe/London')::date, interval '1 day') as d(dt)
               left join (select pv.day as day, sum(pv.views)::int as views, sum(pv.entries)::int as entries from public.page_views_daily pv where pv.day >= v_from group by pv.day) x on x.day = d.dt::date
               left join (select (created_at at time zone 'Europe/London')::date as day, count(*)::int as n from auth.users
                           where created_at >= v_from::timestamp at time zone 'Europe/London' group by 1) su on su.day = d.dt::date), '[]'::jsonb),
    'pages', coalesce((select jsonb_agg(jsonb_build_object('path', path, 'views', views, 'visits', entries) order by views desc, entries desc, path)
               from (select path, sum(views)::int views, sum(entries)::int entries from public.page_views_daily where day >= v_from group by path order by 2 desc, 3 desc, 1 limit 15) t), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('source', source, 'visits', entries) order by entries desc)
               from (select source, sum(entries)::int entries from public.page_views_daily where day >= v_from and entries > 0 group by source order by 2 desc limit 15) t), '[]'::jsonb),
    'pilots', (select count(*)::int from public.audit_events where action = 'pilot_started' and created_at >= v_from::timestamp at time zone 'Europe/London')
  );
end $$;

revoke all on function app_api.record_page_view(jsonb), app_api.owner_visits(jsonb) from public, anon, authenticated, service_role;
grant execute on function app_api.record_page_view(jsonb), app_api.owner_visits(jsonb) to service_role;
