import { authed } from '../../../../../../server/guard.ts';
import { ApiError, readJson } from '../../../../../../server/http.ts';
import { getDb } from '../../../../../../server/db.ts';
import { scenarioArchiveInput, scenarioKeySchema } from '../../../../../../lib/domain/schemas.ts';

/** Archive (reps can no longer start it; old sessions keep it) or restore a scenario. */
export const POST = authed(async (req, { user, params }) => {
  const key = scenarioKeySchema.safeParse(params.key);
  if (!key.success) throw new ApiError(404, 'not_found', 'Not found.');
  const { archived } = await readJson(req, scenarioArchiveInput);
  return getDb().user(user.accessToken, user.id).rpc('set_scenario_archived', { key: key.data, archived });
}, { rate: { name: 'scenario', perMinute: 20 } });
