import { authed, uuidParam } from '../../../../../server/guard.ts';
import { readJson } from '../../../../../server/http.ts';
import { endSessionInput } from '../../../../../lib/domain/schemas.ts';
import { endSession } from '../../../../../server/services/practice.ts';

export const POST = authed(async (req, { user, params }) => {
  await readJson(req, endSessionInput);
  return endSession(user, uuidParam(params.id));
}, { rate: { name: 'end', perMinute: 20 } });
