import { authed } from '../../../../server/guard.ts';
import { readJson } from '../../../../server/http.ts';
import { getDb } from '../../../../server/db.ts';
import { acceptInvitationInput } from '../../../../lib/domain/schemas.ts';
import { hashToken } from '../../../../server/tokens.ts';

/** Email match, confirmation, expiry, revocation and single use are enforced atomically in the database. */
export const POST = authed(async (req, { user }) => {
  const { token } = await readJson(req, acceptInvitationInput);
  return getDb().user(user.accessToken, user.id).rpc('accept_invitation', { token_hash: hashToken(token) });
}, { rate: { name: 'invite-accept', perMinute: 10 } });
