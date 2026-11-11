import { authed } from '../../../server/guard.ts';
import { getDb } from '../../../server/db.ts';
import { billingConfigured } from '../../../server/services/billing.ts';

/** Manager: the team's billing status (D45). Stripe IDs stay on the server. */
export const GET = authed(async (_req, { user }) => {
  const b = await getDb().user(user.accessToken, user.id).rpc<Record<string, unknown>>('my_billing', {});
  const { customerId: _c, subscriptionId: _s, ...rest } = b ?? {};
  return { ...rest, available: billingConfigured() };
});
