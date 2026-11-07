import { authed, uuidParam } from '../../../../../server/guard.ts';
import { ApiError, readJson } from '../../../../../server/http.ts';
import { audioTurnMeta, typedTurnInput } from '../../../../../lib/domain/schemas.ts';
import { LIMITS } from '../../../../../lib/domain/limits.ts';
import { submitTurn } from '../../../../../server/services/practice.ts';

/**
 * One rep turn: JSON {text, expectedSequence, idempotencyKey} or multipart with `audio`.
 * Transport limit 10 MiB (hosting platforms may impose a lower request-body limit — see README).
 */
export const POST = authed(async (req, { user, params }) => {
  const id = uuidParam(params.id);
  const ct = req.headers.get('content-type') ?? '';
  if (ct.startsWith('multipart/form-data')) {
    const len = Number(req.headers.get('content-length') ?? '0');
    if (len > LIMITS.audioMaxBytes + 64 * 1024) throw new ApiError(413, 'audio_too_large', 'That recording is too large. Record a shorter turn or type it.');
    let form: FormData;
    try { form = await req.formData(); } catch { throw new ApiError(400, 'invalid_form', 'Could not read the recording upload.'); }
    const audio = form.get('audio');
    if (!(audio instanceof Blob)) throw new ApiError(400, 'invalid_input', 'Missing audio.');
    const meta = audioTurnMeta.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string')));
    if (!meta.success) throw new ApiError(400, 'invalid_input', 'Some fields are missing or invalid.');
    if (audio.size > LIMITS.audioMaxBytes) throw new ApiError(413, 'audio_too_large', 'That recording is too large. Record a shorter turn or type it.');
    return submitTurn(user, id, { kind: 'audio', audio: new Uint8Array(await audio.arrayBuffer()), mimeType: audio.type, ...meta.data });
  }
  const input = await readJson(req, typedTurnInput);
  return submitTurn(user, id, { kind: 'typed', ...input });
}, { rate: { name: 'turn', perMinute: 30 } });
