import { open } from '../../../../server/guard.ts';
import { readJson } from '../../../../server/http.ts';
import { authenticate } from '../../../../server/auth.ts';
import { getDb } from '../../../../server/db.ts';
import { acceptInvitationInput } from '../../../../lib/domain/schemas.ts';
import { hashToken } from '../../../../server/tokens.ts';

/** Describes an invitation for the landing page. The raw token is hashed immediately and never logged. */
export const POST = open(async (req) => {
  const { token } = await readJson(req, acceptInvitationInput);
  const auth = await authenticate(req);
  return getDb().service().rpc('inspect_invitation', { token_hash: hashToken(token), user_id: auth.user?.id ?? null });
}, { rate: { name: 'invite-check', perMinute: 20 } });
