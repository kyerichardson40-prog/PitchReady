import { authed } from '../../../server/guard.ts';
import { readJson } from '../../../server/http.ts';
import { getDb } from '../../../server/db.ts';
import { startSessionInput } from '../../../lib/domain/schemas.ts';
import { startSession } from '../../../server/services/practice.ts';

export const GET = authed(async (_req, { user }) => getDb().user(user.accessToken, user.id).rpc('list_my_sessions'));

export const POST = authed(async (req, { user }) => {
  const input = await readJson(req, startSessionInput);
  return startSession(user, input);
}, { rate: { name: 'start', perMinute: 10 } });
