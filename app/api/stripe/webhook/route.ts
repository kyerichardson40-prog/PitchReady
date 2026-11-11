import { json, route, ApiError } from '../../../../server/http.ts';
import { handleWebhook } from '../../../../server/services/billing.ts';

/**
 * Stripe webhook (D45). Not same-origin (Stripe calls it); trust comes from the signature check
 * with STRIPE_WEBHOOK_SECRET on the exact raw body. Each event is applied once.
 */
export const POST = route(async (req, { rid }) => {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > 1_000_000) throw new ApiError(413, 'payload_too_large', 'Too large.');
  const raw = await req.text();
  if (raw.length > 1_000_000) throw new ApiError(413, 'payload_too_large', 'Too large.');
  const r = await handleWebhook(raw, req.headers.get('stripe-signature'));
  return json({ received: true, outcome: r.outcome }, { requestId: rid });
});
