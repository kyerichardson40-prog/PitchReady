import { authed, uuidParam } from '../../../../../server/guard.ts';
import { ApiError, readJson } from '../../../../../server/http.ts';
import { audioTurnMeta, typedTurnInput } from '../../../../../lib/domain/schemas.ts';
import { LIMITS } from '../../../../../lib/domain/limits.ts';
import { submitTurn, type TurnEvents, type TurnResponse } from '../../../../../server/services/practice.ts';

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
    const bytes = new Uint8Array(await audio.arrayBuffer());
    return respond(req, (events) => submitTurn(user, id, { kind: 'audio', audio: bytes, mimeType: audio.type, ...meta.data }, events));
  }
  const input = await readJson(req, typedTurnInput);
  return respond(req, (events) => submitTurn(user, id, { kind: 'typed', ...input }, events));
}, { rate: { name: 'turn', perMinute: 30 } });

/**
 * With `Accept: application/x-ndjson`, sends one JSON line per event as it happens:
 * {type:'rep'|'partial'|'audio'|'done'|'error', …}. Otherwise the whole result at the end, as before.
 * All checks (sign-in, origin, input) have already passed before the stream starts.
 */
function respond(req: Request, run: (events?: TurnEvents) => Promise<TurnResponse>): Promise<TurnResponse> | Response {
  if (!(req.headers.get('accept') ?? '').includes('application/x-ndjson')) return run();
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(ctl) {
      const send = (o: unknown) => { try { ctl.enqueue(enc.encode(JSON.stringify(o) + '\n')); } catch { /* client went away */ } };
      let lastPartial = 0;
      try {
        const r = await run({
          rep: (session) => send({ type: 'rep', session }),
          // Partial text at most ~10 times a second.
          partial: (text) => { const now = Date.now(); if (now - lastPartial > 90) { lastPartial = now; send({ type: 'partial', text }); } },
          audio: (index, audio) => send({ type: 'audio', index, ...audio }),
        });
        send({ type: 'done', ...r });
      } catch (e) {
        const err = e instanceof ApiError ? e : null;
        if (!err) console.error('[turn] stream failed', (e as Error)?.name);
        send({ type: 'error', status: err?.status ?? 500, code: err?.code ?? 'internal_error', message: err?.message ?? 'Something went wrong. Please try again.' });
      } finally {
        try { ctl.close(); } catch { /* already closed */ }
      }
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
}
