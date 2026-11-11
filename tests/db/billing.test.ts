/** Billing via Stripe (DECISIONS D45) on real PostgreSQL + migrations. Run: npm run test:db */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { dropDatabase, freshDatabase, seedTwoAgencies, type Fixture } from './harness.ts';
import { psql } from '../../server/db.ts';
import { ApiError } from '../../server/http.ts';

let f: Fixture;
before(async () => { f = await seedTwoAgencies(await freshDatabase()); });
after(async () => { if (f) await dropDatabase(f.url); });
const svc = () => f.db.service();
const one = async (sql: string) => (await psql(f.url, sql)).trim().split('\n').at(-1)!.trim();
let n = 0;
const ev = (type: string, extra: Record<string, unknown>) => svc().rpc<any>('billing_apply_event', { event_id: `evt_${++n}`, type, created: Math.floor(Date.now() / 1000) + n, ...extra });

test('owner links a team to a Stripe customer; another team can’t use the same customer; managers see their own', async () => {
  const r: any = await svc().rpc('owner_link_billing', { actor_id: f.A.manager, agency_id: f.A.agency, customer_id: 'cus_A1' });
  assert.equal(r.linked, true);
  await assert.rejects(svc().rpc('owner_link_billing', { actor_id: f.A.manager, agency_id: f.B.agency, customer_id: 'cus_A1' }), (e: unknown) => e instanceof ApiError && e.code === 'invalid_input');
  await assert.rejects(svc().rpc('owner_link_billing', { actor_id: f.A.manager, agency_id: f.B.agency, customer_id: 'nope' }), (e: unknown) => e instanceof ApiError && e.code === 'invalid_input');
  assert.equal(((await f.db.user('', f.A.manager).rpc('my_billing', {})) as any).customerId, 'cus_A1');
  assert.equal(((await f.db.user('', f.B.manager).rpc('my_billing', {})) as any).linked, false);
  await assert.rejects(f.db.user('', f.A.rep1).rpc('my_billing', {}), (e: unknown) => e instanceof ApiError && e.code === 'forbidden');
  await assert.rejects(f.db.user('', f.A.manager).rpc('billing_apply_event', { event_id: 'x', type: 'invoice.paid' }), (e: unknown) => e instanceof ApiError);
});

test('active subscription sets the monthly practice time; a paid invoice starts a period if none is running; events apply once', async () => {
  await psql(f.url, `update public.usage_periods set ends_at = now() - interval '1 minute', starts_at = now() - interval '31 days' where agency_id = '${f.A.agency}'`);
  const s = await ev('customer.subscription.created', { customer_id: 'cus_A1', subscription_id: 'sub_1', status: 'active', period_end: Math.floor(Date.now() / 1000) + 30 * 86400, practice_minutes: 600 });
  assert.equal(s.outcome, 'allowance_set');
  assert.equal(await one(`select renew_allowance_seconds from public.agencies where id = '${f.A.agency}'`), '36000');
  const paid = await svc().rpc<any>('billing_apply_event', { event_id: 'evt_paid', type: 'invoice.paid', created: Math.floor(Date.now() / 1000) + 100, customer_id: 'cus_A1', subscription_id: 'sub_1', invoice_url: 'https://invoice.stripe.com/i/x', billing_reason: 'subscription_create' });
  assert.equal(paid.outcome, 'period_started');
  assert.equal(await one(`select allowance_seconds from public.usage_periods where agency_id = '${f.A.agency}' and ends_at > now()`), '36000');
  assert.equal((await svc().rpc<any>('billing_apply_event', { event_id: 'evt_paid', type: 'invoice.paid', customer_id: 'cus_A1', subscription_id: 'sub_1' })).outcome, 'duplicate');
  assert.equal(await one(`select count(*) from public.usage_periods where agency_id = '${f.A.agency}' and ends_at > now()`), '1', 'no second period');
  const mine: any = await f.db.user('', f.A.manager).rpc('my_billing', {});
  assert.equal(mine.status, 'active'); assert.equal(mine.lastInvoiceStatus, 'paid'); assert.equal(mine.practiceMinutes, 600);
});

test('a failed payment is recorded but keeps access; cancellation stops renewals; older events don’t undo newer ones', async () => {
  await ev('invoice.payment_failed', { customer_id: 'cus_A1', subscription_id: 'sub_1', invoice_url: 'https://invoice.stripe.com/i/y' });
  assert.equal(((await f.db.user('', f.A.manager).rpc('my_billing', {})) as any).lastInvoiceStatus, 'payment_failed');
  assert.equal(await one(`select renew_allowance_seconds from public.agencies where id = '${f.A.agency}'`), '36000');
  const cancelledAt = Math.floor(Date.now() / 1000) + 1000;
  const c = await svc().rpc<any>('billing_apply_event', { event_id: 'evt_cancel', type: 'customer.subscription.deleted', created: cancelledAt, customer_id: 'cus_A1', subscription_id: 'sub_1', status: 'canceled' });
  assert.equal(c.outcome, 'renewals_stopped');
  assert.equal(await one(`select coalesce(renew_allowance_seconds::text, 'null') from public.agencies where id = '${f.A.agency}'`), 'null');
  assert.equal(await one(`select count(*) from public.usage_periods where agency_id = '${f.A.agency}' and ends_at > now()`), '1', 'the paid period runs to its end');
  const stale = await svc().rpc<any>('billing_apply_event', { event_id: 'evt_old', type: 'customer.subscription.updated', created: cancelledAt - 500, customer_id: 'cus_A1', subscription_id: 'sub_1', status: 'active' });
  assert.equal(stale.outcome, 'stale');
  assert.equal(((await f.db.user('', f.A.manager).rpc('my_billing', {})) as any).status, 'canceled');
});

test('the first paid invoice replaces a running free period with the paid one straight away', async () => {
  await svc().rpc('owner_link_billing', { actor_id: f.B.manager, agency_id: f.B.agency, customer_id: 'cus_B2' });
  assert.equal(await one(`select count(*) from public.usage_periods where agency_id = '${f.B.agency}' and ends_at > now()`), '1', 'a pilot-style period is running');
  const r = await ev('invoice.paid', { customer_id: 'cus_B2', subscription_id: 'sub_B2', billing_reason: 'subscription_create', practice_minutes: 300 });
  assert.equal(r.outcome, 'period_started');
  assert.equal(await one(`select allowance_seconds from public.usage_periods where agency_id = '${f.B.agency}' and starts_at <= now() and ends_at > now()`), '18000');
  assert.equal(await one(`select count(*) from public.usage_periods where agency_id = '${f.B.agency}' and ends_at > now()`), '1');
  // A renewal invoice doesn't restart the period.
  const again = await ev('invoice.paid', { customer_id: 'cus_B2', subscription_id: 'sub_B2', billing_reason: 'subscription_cycle', practice_minutes: 300 });
  assert.equal(again.outcome, 'applied');
  await svc().rpc('owner_link_billing', { actor_id: f.B.manager, agency_id: f.B.agency, customer_id: null });
});

test('unknown customers are ignored; a customer carrying a team ID is linked on first sight', async () => {
  assert.equal((await ev('invoice.paid', { customer_id: 'cus_unknown' })).outcome, 'no_team');
  const r = await ev('customer.subscription.created', { customer_id: 'cus_B1', agency_hint: f.B.agency, subscription_id: 'sub_B', status: 'active' });
  assert.equal(r.agencyId, f.B.agency);
  assert.equal(((await f.db.user('', f.B.manager).rpc('my_billing', {})) as any).customerId, 'cus_B1');
  await svc().rpc('owner_link_billing', { actor_id: f.A.manager, agency_id: f.B.agency, customer_id: null });
  assert.equal(((await f.db.user('', f.B.manager).rpc('my_billing', {})) as any).linked, false);
});
