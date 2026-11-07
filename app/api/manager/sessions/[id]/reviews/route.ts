import { authed, uuidParam } from '../../../../../../server/guard.ts';
import { readJson } from '../../../../../../server/http.ts';
import { getDb } from '../../../../../../server/db.ts';
import { reviewInput } from '../../../../../../lib/domain/schemas.ts';

/** Separate, append-only human review record; the AI evaluation is never edited. */
export const POST = authed(async (req, { user, params }) => {
  const input = await readJson(req, reviewInput);
  return getDb().user(user.accessToken, user.id).rpc('add_review', { session_id: uuidParam(params.id), note: input.note, resolution: input.resolution, report_id: input.reportId ?? null });
}, { rate: { name: 'review', perMinute: 30 } });
