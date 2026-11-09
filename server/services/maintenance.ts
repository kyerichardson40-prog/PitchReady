import { getDb } from '../db.ts';
import { runEvaluationJob } from './evaluation.ts';

export type MaintenanceResult = Record<string, unknown> & { evaluations: Record<string, number> };

/**
 * Expire sessions and release reservations, reset stale leases, honour deletion requests, apply
 * retention, then work through pending evaluation jobs (bounded by count and time).
 * Shared by POST /api/maintenance and the in-process scheduler (server/scheduler.ts).
 */
export async function runMaintenance(budgetMs = 50_000): Promise<MaintenanceResult> {
  const result: any = await getDb().service().rpc('maintenance_run', { abandon_grace_seconds: 120 });
  const evaluations: Record<string, number> = {};
  const started = Date.now();
  for (let i = 0; i < 20 && Date.now() - started < budgetMs; i++) {
    const r = await runEvaluationJob();
    if (r === 'none') break;
    evaluations[r] = (evaluations[r] ?? 0) + 1;
  }
  // Enquiry retention (12 months). Skipped quietly until the contact_messages migration is applied.
  let purged: Record<string, unknown> = {};
  try { purged = (await getDb().service().rpc<any>('purge_contact_messages', {})) ?? {}; } catch { /* not installed yet */ }
  return { ...(result ?? {}), ...purged, evaluations };
}
