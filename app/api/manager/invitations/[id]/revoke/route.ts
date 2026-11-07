import { authed, uuidParam } from '../../../../../../server/guard.ts';
import { getDb } from '../../../../../../server/db.ts';

export const POST = authed(async (_req, { user, params }) => getDb().user(user.accessToken, user.id).rpc('revoke_invitation', { invitation_id: uuidParam(params.id) }));
