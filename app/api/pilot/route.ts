import { z } from 'zod';
import { authed } from '../../../server/guard.ts';
import { ApiError, readJson } from '../../../server/http.ts';
import { getDb } from '../../../server/db.ts';
import { getConfig } from '../../../server/config.ts';
import { bootstrapPayload } from '../../../lib/content/bootstrap-payload.ts';
import { notifyOwner } from '../../../server/services/notify.ts';

/**
 * Start a free pilot: a signed-in person with a confirmed email and no team creates their own team
 * and becomes its manager. Starter content is the fictional example pack; the allowance is small and
 * does not renew. The database enforces one pilot per person and a daily cap (create_pilot_agency).
 */
const input = z.object({
  teamName: z.string().trim().min(2).max(120),
  yourName: z.string().trim().min(1).max(80),
}).strict();

export const POST = authed(async (req, { user }) => {
  const { env } = getConfig();
  if (env.SELF_SERVE_PILOTS !== 'true') throw new ApiError(403, 'pilots_closed', 'New pilots are by arrangement at the moment. Please use the contact page.');
  if (!user.emailConfirmed) throw new ApiError(403, 'email_unconfirmed', 'Confirm your email address first — check your inbox for the link.');
  const { teamName, yourName } = await readJson(req, input);
  const payload = bootstrapPayload({
    agencyName: teamName, managerEmail: user.email, managerName: yourName,
    allowanceSeconds: env.SELF_SERVE_PILOT_SECONDS ?? 3600, periodDays: env.SELF_SERVE_PILOT_DAYS ?? 14,
  });
  await getDb().service().rpc('create_pilot_agency', { user_id: user.id, agency_name: teamName, manager_name: yourName, payload });
  // Tell the owner; best effort, and no personal details beyond the team name.
  await notifyOwner(`New PitchReady pilot: ${teamName}`, ['Someone has started a free pilot on PitchReady.', '', `Team: ${teamName}`, `Manager: ${yourName} <${user.email}>`]);
  return { ok: true };
}, { rate: { name: 'pilot', perMinute: 3 } });
