import { authed } from '../../../../server/guard.ts';
import { getDb } from '../../../../server/db.ts';
import { rosterWithDirectory } from '../../../../server/manager-data.ts';

/** The rep database: members with practice statistics and scenario assignments, plus invitations. */
export const GET = authed(async (_req, { user }) => rosterWithDirectory(getDb().user(user.accessToken, user.id)));
