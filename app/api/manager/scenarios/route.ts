import { authed } from '../../../../server/guard.ts';
import { readJson } from '../../../../server/http.ts';
import { getDb } from '../../../../server/db.ts';
import { scenarioInput } from '../../../../lib/domain/schemas.ts';

/** Every scenario (latest version, archived included) and the reps' assignments. */
export const GET = authed(async (_req, { user }) => getDb().user(user.accessToken, user.id).rpc('scenario_admin'));

/** Creates a scenario (no key) or saves a new version of one. Structured fields only. */
export const POST = authed(async (req, { user }) => {
  const input = await readJson(req, scenarioInput);
  return getDb().user(user.accessToken, user.id).rpc('save_scenario', input);
}, { rate: { name: 'scenario', perMinute: 20 } });
