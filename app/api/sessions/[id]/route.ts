import { authed, uuidParam } from '../../../../server/guard.ts';
import { ApiError } from '../../../../server/http.ts';
import { getDb } from '../../../../server/db.ts';

/** Returns only what RLS lets this user read: own session (rep) or agency session (manager). */
export const GET = authed(async (_req, { user, params }) => {
  const r = await getDb().user(user.accessToken, user.id).rpc('get_session', { session_id: uuidParam(params.id) });
  if (!r) throw new ApiError(404, 'not_found', 'Session not found.');
  return r;
});
