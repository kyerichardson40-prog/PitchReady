import { authed, uuidParam } from '../../../../server/guard.ts';
import { getDb } from '../../../../server/db.ts';

/** Archive a practice task (managers only; checked in the database). */
export const DELETE = authed(async (_req, { user, params }) => {
  await getDb().user(user.accessToken, user.id).rpc('archive_task', { task_id: uuidParam(params.id) });
  return { archived: true };
});
