import { authed } from '../../../../server/guard.ts';
import { readJson } from '../../../../server/http.ts';
import { getDb } from '../../../../server/db.ts';
import { getConfig } from '../../../../server/config.ts';
import { invitationInput } from '../../../../lib/domain/schemas.ts';
import { newInvitationToken } from '../../../../server/tokens.ts';

/** Returns the link ONCE for the manager to copy. Only the token hash is stored; nothing is emailed. */
export const POST = authed(async (req, { user }) => {
  const input = await readJson(req, invitationInput);
  const { token, hash } = newInvitationToken();
  const r: any = await getDb().user(user.accessToken, user.id).rpc('create_invitation', { email: input.email, role: input.role, expires_in_days: input.expiresInDays, token_hash: hash });
  return { link: `${getConfig().env.APP_BASE_URL}/invite/${token}`, expiresAt: r.expiresAt };
}, { rate: { name: 'invite', perMinute: 10 } });
