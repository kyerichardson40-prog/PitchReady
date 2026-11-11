import { authed } from '../../../../server/guard.ts';
import { getDb } from '../../../../server/db.ts';
import { getConfig } from '../../../../server/config.ts';
import { ApiError } from '../../../../server/http.ts';
import { portalUrl } from '../../../../server/services/billing.ts';

/** Manager: open Stripe's customer portal for the team (invoices, payment details). D45. */
export const POST = authed(async (_req, { user }) => {
  const b = await getDb().user(user.accessToken, user.id).rpc<{ linked: boolean; customerId?: string }>('my_billing', {});
  if (!b?.linked || !b.customerId) throw new ApiError(404, 'not_found', 'Billing isn’t set up for your team yet. Contact PitchReady to arrange it.');
  const base = getConfig().env.APP_BASE_URL.replace(/\/$/, '');
  return { url: await portalUrl(b.customerId, `${base}/manager/billing`) };
}, { rate: { name: 'billing-portal', perMinute: 10 } });
