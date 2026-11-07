import { authed, uuidParam } from '../../../../../server/guard.ts';
import { evaluateNow } from '../../../../../server/services/practice.ts';

/** Bounded, idempotent: never creates a second successful evaluation for the same transcript revision. */
export const POST = authed(async (_req, { user, params }) => evaluateNow(user, uuidParam(params.id)), { rate: { name: 'evaluate', perMinute: 6 } });
