import { authed, uuidParam } from '../../../../../../server/guard.ts';
import { readJson } from '../../../../../../server/http.ts';
import { getDb } from '../../../../../../server/db.ts';
import { correctionInput } from '../../../../../../lib/domain/schemas.ts';
import { runEvaluationJob } from '../../../../../../server/services/evaluation.ts';

/** Appends a correction → new transcript revision → new evaluation; earlier feedback is preserved. */
export const POST = authed(async (req, { user, params }) => {
  const input = await readJson(req, correctionInput);
  const id = uuidParam(params.id);
  const s = await getDb().user(user.accessToken, user.id).rpc('add_correction', { session_id: id, turn_label: input.turnId, corrected_text: input.correctedText, note: input.note ?? null, request_id: input.idempotencyKey });
  await runEvaluationJob(id).catch(() => undefined);
  return s;
}, { rate: { name: 'correction', perMinute: 10 } });
