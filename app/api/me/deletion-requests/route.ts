import { authed } from '../../../../server/guard.ts';
import { getDb } from '../../../../server/db.ts';
import { readJson } from '../../../../server/http.ts';
import { deletionRequestInput } from '../../../../lib/domain/schemas.ts';

export const POST = authed(async (req, { user }) => {
  const input = await readJson(req, deletionRequestInput);
  return getDb().user(user.accessToken, user.id).rpc('request_deletion', { scope: input.scope, note: input.note ?? null });
}, { rate: { name: 'deletion', perMinute: 5 } });
