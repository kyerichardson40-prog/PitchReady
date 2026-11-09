import { authed } from '../../../../server/guard.ts';
import { readJson } from '../../../../server/http.ts';
import { getDb } from '../../../../server/db.ts';
import { getConfig } from '../../../../server/config.ts';
import { invitationInput } from '../../../../lib/domain/schemas.ts';
import { newInvitationToken } from '../../../../server/tokens.ts';
import { emailConfigured, invitationEmail, sendEmail } from '../../../../server/services/notify.ts';

/**
 * Returns the link ONCE for the manager to copy; only the token hash is stored. When an email
 * service is configured the link is also emailed to the invited person (best effort: `emailed`
 * says whether it went, so the manager knows if they still need to send the link themselves).
 */
export const POST = authed(async (req, { user }) => {
  const input = await readJson(req, invitationInput);
  const { token, hash } = newInvitationToken();
  const db = getDb().user(user.accessToken, user.id);
  const r: any = await db.rpc('create_invitation', { email: input.email, role: input.role, expires_in_days: input.expiresInDays, token_hash: hash });
  const link = `${getConfig().env.APP_BASE_URL}/invite/${token}`;
  let emailed = false;
  if (emailConfigured()) {
    const ctx: any = await db.rpc('my_context').catch(() => null);
    const { subject, text } = invitationEmail({ agencyName: ctx?.agency?.name ?? 'your team', inviterName: ctx?.profile?.displayName ?? 'Your manager', role: input.role, link, expiresAt: r.expiresAt });
    emailed = (await sendEmail({ to: [input.email], subject, text, replyTo: user.email, tag: 'invite' })) === 'sent';
  }
  return { link, expiresAt: r.expiresAt, emailed };
}, { rate: { name: 'invite', perMinute: 10 } });
