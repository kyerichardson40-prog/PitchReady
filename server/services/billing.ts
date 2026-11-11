/**
 * Billing through Stripe (DECISIONS D45). The owner sells and invoices in Stripe; this file turns
 * Stripe's webhook events into small, checked updates in the database, opens Stripe's customer
 * portal for managers, and creates or checks Stripe customers for the owner suite.
 * One Stripe client per process, created from STRIPE_SECRET_KEY (a restricted key is recommended).
 */
import Stripe from 'stripe';
import { getConfig } from '../config.ts';
import { getDb } from '../db.ts';
import { ApiError } from '../http.ts';

let client: Stripe | null = null;
let clientKey: string | undefined;

export function billingConfigured(): boolean { return !!getConfig().env.STRIPE_SECRET_KEY; }

export function stripeClient(): Stripe {
  const key = getConfig().env.STRIPE_SECRET_KEY;
  if (!key) throw new ApiError(503, 'billing_unavailable', 'Billing isn’t set up yet.');
  if (!client || clientKey !== key) {
    client = new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: 'PitchReady' } });
    clientKey = key;
  }
  return client;
}

/** Test keys (sk_test_/rk_test_) link to Stripe's test Dashboard. */
export function dashboardUrl(path: string): string {
  const key = getConfig().env.STRIPE_SECRET_KEY ?? '';
  return `https://dashboard.stripe.com/${/_test_/.test(key) ? 'test/' : ''}${path.replace(/^\//, '')}`;
}

const idOf = (v: unknown): string | null => (typeof v === 'string' ? v : v && typeof v === 'object' && 'id' in v ? String((v as { id: unknown }).id) : null);
function minutesOf(meta: Record<string, string> | null | undefined): number | null {
  const n = Number(meta?.practice_minutes);
  return Number.isInteger(n) && n >= 1 && n <= 100000 ? n : null;
}

/** The facts the database needs from one Stripe event (nothing else is stored). */
export function billingPayload(event: Stripe.Event): Record<string, unknown> | null {
  const o = event.data.object as any;
  const base = { event_id: event.id, type: event.type, created: event.created, customer_id: idOf(o.customer) };
  if (event.type.startsWith('customer.subscription.')) {
    const item = o.items?.data?.[0];
    return { ...base, subscription_id: o.id, status: o.status, cancel_at_period_end: !!o.cancel_at_period_end,
      period_end: item?.current_period_end ?? o.current_period_end ?? null, practice_minutes: minutesOf(o.metadata), agency_hint: o.metadata?.agency_id ?? null };
  }
  if (event.type.startsWith('invoice.')) {
    const sub = o.parent?.subscription_details;
    return { ...base, subscription_id: idOf(sub?.subscription) ?? idOf(o.subscription), invoice_url: o.hosted_invoice_url ?? null,
      billing_reason: o.billing_reason ?? null, practice_minutes: minutesOf(sub?.metadata), agency_hint: sub?.metadata?.agency_id ?? null };
  }
  return null;
}

export const HANDLED_EVENTS = [
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'invoice.paid', 'invoice.payment_failed', 'invoice.finalized', 'invoice.marked_uncollectible', 'invoice.voided',
] as const;

/** Verifies the signature (throws 400 if wrong) and applies the event once. */
export async function handleWebhook(rawBody: string, signature: string | null): Promise<{ outcome: string }> {
  const secret = getConfig().env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !billingConfigured()) throw new ApiError(503, 'billing_unavailable', 'Billing isn’t set up yet.');
  if (!signature) throw new ApiError(400, 'invalid_input', 'Missing Stripe signature.');
  let event: Stripe.Event;
  try { event = stripeClient().webhooks.constructEvent(rawBody, signature, secret); }
  catch { throw new ApiError(400, 'invalid_input', 'Stripe signature check failed.'); }
  if (!(HANDLED_EVENTS as readonly string[]).includes(event.type)) return { outcome: 'ignored' };
  const payload = billingPayload(event);
  if (!payload) return { outcome: 'ignored' };
  return getDb().service().rpc<{ outcome: string }>('billing_apply_event', payload);
}

/** Manager: a short-lived link to Stripe's customer portal (invoices, payment method, plan). */
export async function portalUrl(customerId: string, returnUrl: string): Promise<string> {
  const s = await stripeClient().billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
  return s.url;
}

/** Owner: create a Stripe customer for a team (tagged with the team's ID), or check an existing one. */
export async function createCustomer(team: { id: string; name: string; email: string | null }): Promise<string> {
  const c = await stripeClient().customers.create(
    { name: team.name, ...(team.email ? { email: team.email } : {}), metadata: { agency_id: team.id } },
    { idempotencyKey: `pitchready-customer-${team.id}` },
  );
  return c.id;
}
export async function checkCustomer(customerId: string, agencyId: string): Promise<void> {
  let c: Stripe.Customer | Stripe.DeletedCustomer;
  try { c = await stripeClient().customers.retrieve(customerId); }
  catch { throw new ApiError(400, 'invalid_input', 'Stripe couldn’t find that customer. Check the ID (it starts with cus_) and that it’s in the same Stripe account.'); }
  if ((c as Stripe.DeletedCustomer).deleted) throw new ApiError(400, 'invalid_input', 'That Stripe customer has been deleted.');
  const other = (c as Stripe.Customer).metadata?.agency_id;
  if (other && other !== agencyId) throw new ApiError(400, 'invalid_input', 'That Stripe customer belongs to a different PitchReady team.');
  if (!other) await stripeClient().customers.update(customerId, { metadata: { agency_id: agencyId } });
}
