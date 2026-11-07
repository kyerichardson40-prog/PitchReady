import { timingSafeEqual } from 'node:crypto';
import { route, ApiError, json } from '../../../server/http.ts';
import { getConfig, connectedReady } from '../../../server/config.ts';
import { getDb } from '../../../server/db.ts';
import { runEvaluationJob } from '../../../server/services/evaluation.ts';

/**
 * Scheduled maintenance: expire sessions and release reservations, reset stale leases, honour
 * deletion requests, apply retention, then work through pending evaluation jobs (bounded).
 * Requires `Authorization: Bearer <MAINTENANCE_SECRET>`; unknown callers get 401.
 */
export const POST = route(async (req, { rid }) => {
  const cfg = getConfig();
  if (!connectedReady(cfg)) throw new ApiError(503, 'not_configured', 'Not configured.');
  const given = Buffer.from((req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(cfg.env.MAINTENANCE_SECRET ?? '');
  if (want.length < 32 || given.length !== want.length || !timingSafeEqual(given, want)) throw new ApiError(401, 'unauthenticated', 'Not allowed.');
  const result: any = await getDb().service().rpc('maintenance_run', { abandon_grace_seconds: 120 });
  const evaluations: Record<string, number> = {};
  const started = Date.now();
  for (let i = 0; i < 20 && Date.now() - started < 50_000; i++) {
    const r = await runEvaluationJob();
    if (r === 'none') break;
    evaluations[r] = (evaluations[r] ?? 0) + 1;
  }
  return json({ ...result, evaluations }, { requestId: rid });
});
