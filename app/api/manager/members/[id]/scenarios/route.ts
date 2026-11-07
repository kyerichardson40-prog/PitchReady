import { authed, uuidParam } from '../../../../../../server/guard.ts';
import { readJson } from '../../../../../../server/http.ts';
import { getDb } from '../../../../../../server/db.ts';
import { scenarioAssignmentInput } from '../../../../../../lib/domain/schemas.ts';

/** Replaces a rep's scenario assignments. An empty list means every active scenario. */
export const PUT = authed(async (req, { user, params }) => {
  const { keys } = await readJson(req, scenarioAssignmentInput);
  return getDb().user(user.accessToken, user.id).rpc('set_scenario_assignments', { user_id: uuidParam(params.id), keys });
}, { rate: { name: 'assign', perMinute: 30 } });
