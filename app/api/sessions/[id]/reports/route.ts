import { authed, uuidParam } from '../../../../../server/guard.ts';
import { readJson } from '../../../../../server/http.ts';
import { getDb } from '../../../../../server/db.ts';
import { reportInput } from '../../../../../lib/domain/schemas.ts';

/** Reporter identity comes from the session token, never the request body. */
export const POST = authed(async (req, { user, params }) => {
  const input = await readJson(req, reportInput);
  return getDb().user(user.accessToken, user.id).rpc('report_feedback', { session_id: uuidParam(params.id), reason: input.reason, description: input.description, turn_label: input.turnId ?? null });
}, { rate: { name: 'report', perMinute: 10 } });
