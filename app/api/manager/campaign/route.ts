import { z } from 'zod';
import { authed } from '../../../../server/guard.ts';
import { readJson } from '../../../../server/http.ts';
import { getDb } from '../../../../server/db.ts';
import { campaignPackSchema, rubricDimensionsSchema } from '../../../../lib/domain/schemas.ts';

export const GET = authed(async (_req, { user }) => getDb().user(user.accessToken, user.id).rpc('campaign_admin'));

/** Structured pack only — no arbitrary document upload. */
const draftInput = z.object({ pack: campaignPackSchema, rubric: rubricDimensionsSchema }).strict();
export const PUT = authed(async (req, { user }) => {
  const { pack, rubric } = await readJson(req, draftInput, 128 * 1024);
  return getDb().user(user.accessToken, user.id).rpc('save_campaign_draft', { pack, rubric });
}, { rate: { name: 'draft', perMinute: 20 } });
