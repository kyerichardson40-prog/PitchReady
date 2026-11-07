import { authed } from '../../../../../server/guard.ts';
import { getDb } from '../../../../../server/db.ts';

/** Validates facts and rubric anchors in the database, then freezes a new version. */
export const POST = authed(async (_req, { user }) => getDb().user(user.accessToken, user.id).rpc('publish_campaign', {}), { rate: { name: 'publish', perMinute: 5 } });
