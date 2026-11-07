import { z } from 'zod';
import { authed, uuidParam } from '../../../../../server/guard.ts';
import { readJson } from '../../../../../server/http.ts';
import { getDb } from '../../../../../server/db.ts';
import { repProfile } from '../../../../../server/manager-data.ts';

const input = z.object({ active: z.boolean() }).strict();
/** Deactivation takes effect immediately, including open sessions. Roles are never set from here. */
export const POST = authed(async (req, { user, params }) => {
  const { active } = await readJson(req, input);
  return getDb().user(user.accessToken, user.id).rpc('set_member_active', { user_id: uuidParam(params.id), active });
});

/** One rep's profile: statistics, per-dimension breakdown (current rubric), sessions, assignments. */
export const GET = authed(async (_req, { user, params }) => repProfile(getDb().user(user.accessToken, user.id), uuidParam(params.id)));
