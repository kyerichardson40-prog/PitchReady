/** Stripe billing (D45): event → database facts, and the signature check. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { billingPayload } from '../../server/services/billing.ts';

const ev = (type: string, object: Record<string, unknown>) => ({ id: 'evt_1', type, created: 1_800_000_000, data: { object } }) as unknown as Stripe.Event;

test('subscription events carry status, period end (from the item), minutes and the team hint', () => {
  const p = billingPayload(ev('customer.subscription.updated', {
    id: 'sub_1', customer: 'cus_1', status: 'past_due', cancel_at_period_end: true,
    items: { data: [{ current_period_end: 1_802_592_000 }] }, metadata: { practice_minutes: '600', agency_id: 'a-b' },
  }))!;
  assert.deepEqual(p, { event_id: 'evt_1', type: 'customer.subscription.updated', created: 1_800_000_000, customer_id: 'cus_1', subscription_id: 'sub_1',
    status: 'past_due', cancel_at_period_end: true, period_end: 1_802_592_000, practice_minutes: 600, agency_hint: 'a-b' });
  assert.equal(billingPayload(ev('customer.subscription.created', { id: 's', customer: 'c', metadata: { practice_minutes: 'lots' }, items: { data: [] } }))!.practice_minutes, null);
});

test('invoice events read the subscription from invoice.parent and keep only what is needed', () => {
  const p = billingPayload(ev('invoice.paid', {
    id: 'in_1', customer: { id: 'cus_2' }, hosted_invoice_url: 'https://invoice.stripe.com/i/1', billing_reason: 'subscription_cycle',
    parent: { subscription_details: { subscription: 'sub_2', metadata: { practice_minutes: '300' } } }, lines: { data: [{ amount: 9900 }] },
  }))!;
  assert.equal(p.customer_id, 'cus_2'); assert.equal(p.subscription_id, 'sub_2'); assert.equal(p.practice_minutes, 300);
  assert.equal(p.invoice_url, 'https://invoice.stripe.com/i/1');
  assert.ok(!('lines' in p) && !('amount' in p), 'no amounts or line items stored');
  assert.equal(billingPayload(ev('invoice.paid', { id: 'in_2', customer: 'cus_3' }))!.subscription_id, null, 'one-off invoice');
  assert.equal(billingPayload(ev('charge.succeeded', { customer: 'cus_3' })), null);
});

test('webhook signatures: only events signed with the secret pass', () => {
  const stripe = new Stripe('rk_test_dummy');
  const body = JSON.stringify({ id: 'evt_x', type: 'invoice.paid', created: 1, data: { object: { id: 'in', customer: 'cus_1' } } });
  const header = stripe.webhooks.generateTestHeaderString({ payload: body, secret: 'whsec_right' });
  assert.equal(stripe.webhooks.constructEvent(body, header, 'whsec_right').id, 'evt_x');
  assert.throws(() => stripe.webhooks.constructEvent(body, header, 'whsec_wrong'));
  assert.throws(() => stripe.webhooks.constructEvent(body.replace('cus_1', 'cus_2'), header, 'whsec_right'));
});
