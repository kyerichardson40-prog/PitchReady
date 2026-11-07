import { timingSafeEqual } from 'node:crypto';
import { route, ApiError, json } from '../../../server/http.ts';
import { getConfig, connectedReady } from '../../../server/config.ts';
import { runMaintenance } from '../../../server/services/maintenance.ts';

/**
 * Maintenance on demand (the server also runs it on a timer, see server/scheduler.ts): expire sessions and release reservations, reset stale leases, honour
 * deletion requests, apply retention, then work through pending evaluation jobs (bounded).
 * Requires `Authorization: Bearer <MAINTENANCE_SECRET>`; unknown callers get 401.
 */
export const POST = route(async (req, { rid }) => {
  const cfg = getConfig();
  if (!connectedReady(cfg)) throw new ApiError(503, 'not_configured', 'Not configured.');
  const given = Buffer.from((req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(cfg.env.MAINTENANCE_SECRET ?? '');
  if (want.length < 32 || given.length !== want.length || !timingSafeEqual(given, want)) throw new ApiError(401, 'unauthenticated', 'Not allowed.');
  return json(await runMaintenance(), { requestId: rid });
});
