-- Billing through Stripe invoices (DECISIONS D45). The owner sells and invoices from Stripe (quotes,
-- subscriptions, invoices); PitchReady links each team to its Stripe customer and reacts to Stripe's
-- webhooks: a paid subscription invoice keeps the team's practice time renewing (minutes from the
-- subscription's `practice_minutes` metadata, if set); a cancelled or finally unpaid subscription
-- stops renewals, so practice ends with the current period. Nothing here charges anyone.
-- Backwards compatible: new tables and functions only.

create table if not exists public.billing_accounts (
  agency_id uuid primary key references public.agencies(id) on delete cascade,
  stripe_customer_id text not null unique check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  subscription_id text,
  subscription_status text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  practice_minutes int check (practice_minutes is null or practice_minutes between 1 and 100000),
  subscription_event_at timestamptz,
  last_invoice_status text,
  last_invoice_url text,
  last_paid_at timestamptz,
  linked_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.billing_accounts enable row level security;
revoke all on public.billing_accounts from anon, authenticated;

-- Each Stripe event is applied once (Stripe may deliver the same event more than once).
create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  agency_id uuid references public.agencies(id) on delete set null,
  outcome text not null,
  received_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from anon, authenticated;

create or replace function app_private.billing_json(b public.billing_accounts) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when b.agency_id is null then jsonb_build_object('linked', false) else jsonb_build_object(
    'linked', true, 'customerId', b.stripe_customer_id, 'subscriptionId', b.subscription_id, 'status', b.subscription_status,
    'currentPeriodEnd', b.current_period_end, 'cancelAtPeriodEnd', b.cancel_at_period_end, 'practiceMinutes', b.practice_minutes,
    'lastInvoiceStatus', b.last_invoice_status, 'lastInvoiceUrl', b.last_invoice_url, 'lastPaidAt', b.last_paid_at, 'linkedAt', b.linked_at) end
$$;

/** Owner: billing for one team. */
create or replace function app_api.owner_billing(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare b public.billing_accounts;
begin
  select * into b from public.billing_accounts where agency_id = (p ->> 'agency_id')::uuid;
  return app_private.billing_json(b);
end $$;

/** Owner: link a team to a Stripe customer (`customer_id`), or unlink it (null). */
create or replace function app_api.owner_link_billing(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p ->> 'actor_id')::uuid; v_agency uuid := (p ->> 'agency_id')::uuid; v_cus text := nullif(p ->> 'customer_id', ''); b public.billing_accounts;
begin
  if not exists (select 1 from public.agencies where id = v_agency) then perform app_private.fail('not_found', 'Team not found.'); end if;
  if v_cus is null then
    delete from public.billing_accounts where agency_id = v_agency;
    perform app_private.owner_audit(v_actor, v_agency, 'owner_billing_unlinked', 'agency', v_agency::text, '{}'::jsonb);
    return jsonb_build_object('linked', false);
  end if;
  if v_cus !~ '^cus_[A-Za-z0-9]+$' then perform app_private.fail('invalid_input', 'A Stripe customer ID starts with cus_.'); end if;
  if exists (select 1 from public.billing_accounts where stripe_customer_id = v_cus and agency_id <> v_agency) then
    perform app_private.fail('invalid_input', 'That Stripe customer is already linked to another team.');
  end if;
  insert into public.billing_accounts(agency_id, stripe_customer_id) values (v_agency, v_cus)
    on conflict (agency_id) do update set stripe_customer_id = excluded.stripe_customer_id,
      subscription_id = case when public.billing_accounts.stripe_customer_id = excluded.stripe_customer_id then public.billing_accounts.subscription_id end,
      subscription_status = case when public.billing_accounts.stripe_customer_id = excluded.stripe_customer_id then public.billing_accounts.subscription_status end,
      linked_at = case when public.billing_accounts.stripe_customer_id = excluded.stripe_customer_id then public.billing_accounts.linked_at else now() end,
      updated_at = now()
    returning * into b;
  perform app_private.owner_audit(v_actor, v_agency, 'owner_billing_linked', 'agency', v_agency::text, jsonb_build_object('customer_id', v_cus));
  return app_private.billing_json(b);
end $$;

/** Manager: their team's billing (no Stripe IDs for display; the server uses customerId for the portal). */
create or replace function app_api.my_billing(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.memberships; b public.billing_accounts;
begin
  m := app_private.require_manager();
  select * into b from public.billing_accounts where agency_id = m.agency_id;
  return app_private.billing_json(b);
end $$;

/**
 * Server only (the Stripe webhook, after checking Stripe's signature). Applies one event once.
 * p: event_id, type, created (epoch seconds), customer_id, agency_hint, subscription_id, status,
 *    period_end (epoch), cancel_at_period_end, practice_minutes, invoice_status, invoice_url, billing_reason.
 */
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
    -- A customer made from the owner suite carries the team's ID: link it on first sight.
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
      -- Paid but no practice time running (new customer, or renewals had stopped): start a period now.
      if not exists (select 1 from public.usage_periods u where u.agency_id = v_id and u.ends_at > now()) then
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

revoke all on function app_private.billing_json(public.billing_accounts) from public, anon, authenticated, service_role;
revoke all on function app_api.owner_billing(jsonb), app_api.owner_link_billing(jsonb), app_api.my_billing(jsonb), app_api.billing_apply_event(jsonb) from public, anon, authenticated, service_role;
grant execute on function app_api.my_billing(jsonb) to authenticated;
grant execute on function app_api.owner_billing(jsonb), app_api.owner_link_billing(jsonb), app_api.billing_apply_event(jsonb) to service_role;
