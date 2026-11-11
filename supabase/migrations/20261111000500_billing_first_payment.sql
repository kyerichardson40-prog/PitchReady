-- D45 follow-up: the first paid invoice of a subscription starts the paid period straight away.
-- Before, a team still inside a free pilot period kept the pilot's minutes until it ran out.
-- Now, on billing_reason = 'subscription_create', the current period ends now (anything in use
-- settles into it as usual), any prepared future period is removed, and a fresh 30-day period
-- starts with the paid minutes. Later invoices (renewals) keep using the normal renewal.
create or replace function app_private.billing_start_paid_period(p_agency uuid, p_seconds int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.usage_periods set ends_at = now() where agency_id = p_agency and starts_at <= now() and ends_at > now();
  delete from public.usage_periods where agency_id = p_agency and starts_at > now() and consumed_seconds = 0 and reserved_seconds = 0;
  insert into public.usage_periods(agency_id, starts_at, ends_at, allowance_seconds) values (p_agency, now(), now() + interval '30 days', p_seconds);
end $$;
revoke all on function app_private.billing_start_paid_period(uuid, int) from public, anon, authenticated, service_role;

create or replace function app_api.billing_apply_event(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_type text := p ->> 'type'; v_cus text := p ->> 'customer_id'; b public.billing_accounts; a public.agencies;
        v_at timestamptz := to_timestamp(coalesce((p ->> 'created')::bigint, extract(epoch from now())::bigint));
        v_minutes int := nullif(p ->> 'practice_minutes', '')::int; v_status text := p ->> 'status'; v_outcome text := 'applied'; v_id uuid;
begin
  if exists (select 1 from public.stripe_events where id = p ->> 'event_id') then return jsonb_build_object('outcome', 'duplicate'); end if;
  select * into b from public.billing_accounts where stripe_customer_id = v_cus for update;
  if not found and v_cus ~ '^cus_[A-Za-z0-9]+$' and (p ->> 'agency_hint') ~ '^[0-9a-f-]{36}$'
     and exists (select 1 from public.agencies where id = (p ->> 'agency_hint')::uuid)
     and not exists (select 1 from public.billing_accounts where agency_id = (p ->> 'agency_hint')::uuid) then
    insert into public.billing_accounts(agency_id, stripe_customer_id) values ((p ->> 'agency_hint')::uuid, v_cus) returning * into b;
  end if;
  if b.agency_id is null then
    insert into public.stripe_events(id, type, agency_id, outcome) values (p ->> 'event_id', v_type, null, 'no_team') on conflict do nothing;
    return jsonb_build_object('outcome', 'no_team');
  end if;
  v_id := b.agency_id;
  select * into a from public.agencies where id = v_id for update;
  if v_minutes is not null and v_minutes not between 1 and 100000 then v_minutes := null; end if;

  if v_type like 'customer.subscription.%' then
    if b.subscription_event_at is not null and v_at < b.subscription_event_at then
      v_outcome := 'stale';
    else
      update public.billing_accounts set subscription_id = p ->> 'subscription_id',
          subscription_status = case when v_type = 'customer.subscription.deleted' then 'canceled' else v_status end,
          current_period_end = case when p ? 'period_end' and p ->> 'period_end' is not null then to_timestamp((p ->> 'period_end')::bigint) else current_period_end end,
          cancel_at_period_end = coalesce((p ->> 'cancel_at_period_end')::boolean, false),
          practice_minutes = coalesce(v_minutes, practice_minutes), subscription_event_at = v_at, updated_at = now()
        where agency_id = v_id returning * into b;
      if b.subscription_status in ('canceled', 'unpaid', 'incomplete_expired') then
        if a.renew_allowance_seconds is not null then
          update public.agencies set renew_allowance_seconds = null where id = v_id;
          insert into public.audit_events(agency_id, actor_id, action, metadata) values (v_id, null, 'billing_renewals_stopped', jsonb_build_object('status', b.subscription_status));
        end if;
        v_outcome := 'renewals_stopped';
      elsif b.subscription_status in ('active', 'trialing') and b.practice_minutes is not null
            and a.renew_allowance_seconds is distinct from b.practice_minutes * 60 then
        update public.agencies set renew_allowance_seconds = b.practice_minutes * 60, renew_period_days = 30 where id = v_id;
        insert into public.audit_events(agency_id, actor_id, action, metadata) values (v_id, null, 'billing_allowance_set', jsonb_build_object('minutes', b.practice_minutes));
        v_outcome := 'allowance_set';
      end if;
    end if;
  elsif v_type = 'invoice.paid' then
    update public.billing_accounts set last_invoice_status = 'paid', last_invoice_url = coalesce(p ->> 'invoice_url', last_invoice_url), last_paid_at = v_at,
        practice_minutes = coalesce(v_minutes, practice_minutes), updated_at = now() where agency_id = v_id returning * into b;
    if p ->> 'subscription_id' is not null and b.practice_minutes is not null then
      update public.agencies set renew_allowance_seconds = b.practice_minutes * 60, renew_period_days = 30 where id = v_id;
      if p ->> 'billing_reason' = 'subscription_create' then
        perform app_private.billing_start_paid_period(v_id, b.practice_minutes * 60);
        v_outcome := 'period_started';
      elsif not exists (select 1 from public.usage_periods u where u.agency_id = v_id and u.ends_at > now()) then
        insert into public.usage_periods(agency_id, starts_at, ends_at, allowance_seconds) values (v_id, now(), now() + interval '30 days', b.practice_minutes * 60);
        v_outcome := 'period_started';
      end if;
    end if;
    insert into public.audit_events(agency_id, actor_id, action, metadata) values (v_id, null, 'billing_invoice_paid', jsonb_build_object('reason', p ->> 'billing_reason'));
  elsif v_type in ('invoice.payment_failed', 'invoice.finalized', 'invoice.marked_uncollectible', 'invoice.voided') then
    update public.billing_accounts set last_invoice_status = case v_type when 'invoice.payment_failed' then 'payment_failed' when 'invoice.finalized' then 'open'
          when 'invoice.voided' then 'void' else 'uncollectible' end,
        last_invoice_url = coalesce(p ->> 'invoice_url', last_invoice_url), updated_at = now() where agency_id = v_id;
    if v_type = 'invoice.payment_failed' then
      insert into public.audit_events(agency_id, actor_id, action, metadata) values (v_id, null, 'billing_payment_failed', '{}'::jsonb);
    end if;
  else
    v_outcome := 'ignored';
  end if;
  insert into public.stripe_events(id, type, agency_id, outcome) values (p ->> 'event_id', v_type, v_id, v_outcome) on conflict do nothing;
  return jsonb_build_object('outcome', v_outcome, 'agencyId', v_id);
end $$;
revoke all on function app_api.billing_apply_event(jsonb) from public, anon, authenticated, service_role;
grant execute on function app_api.billing_apply_event(jsonb) to service_role;
