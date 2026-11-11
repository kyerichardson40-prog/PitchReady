import { z } from 'zod';
import { authed } from '../../../server/guard.ts';
import { readJson } from '../../../server/http.ts';
import { getDb } from '../../../server/db.ts';
import { TASK_MAX_TARGET, TASK_NOTE_MAX } from '../../../lib/domain/tasks.ts';

/** Practice tasks (DECISIONS D44). Managers see their team's; reps see their own. */
export const GET = authed(async (req, { user }) => {
  const archived = new URL(req.url).searchParams.get('archived') === '1';
  return getDb().user(user.accessToken, user.id).rpc('list_tasks', { include_archived: archived });
});

const input = z.object({
  scenarioKey: z.string().min(1).max(80),
  target: z.number().int().min(1).max(TASK_MAX_TARGET),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  note: z.string().trim().max(TASK_NOTE_MAX).optional(),
  repIds: z.array(z.string().uuid()).max(200).nullable().optional(),
}).strict();

/** Managers only (checked in the database). */
export const POST = authed(async (req, { user }) => {
  const b = await readJson(req, input);
  return getDb().user(user.accessToken, user.id).rpc('create_task', {
    scenario_key: b.scenarioKey, target_count: b.target, due_at: b.dueAt ?? null, note: b.note || null,
    rep_ids: b.repIds?.length ? b.repIds : null,
  });
}, { rate: { name: 'tasks', perMinute: 20 } });
