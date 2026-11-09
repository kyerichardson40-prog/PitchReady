/**
 * Deepgram REST adapters (server-only), per developers.deepgram.com (checked 2026-11-06):
 *  - STT: POST https://api.deepgram.com/v1/listen?model=…  body = raw audio, Content-Type = audio MIME,
 *         transcript at results.channels[0].alternatives[0].transcript, metadata.duration, metadata.request_id
 *  - Every request sets mip_opt_out=true: excluded from Deepgram's Model Improvement Program, so
 *    audio and text are kept only as long as needed to process the request (no training on them).
 *  - TTS: POST https://api.deepgram.com/v1/speak?model=…  body = {"text": …}, returns audio
 *         (headers dg-request-id, dg-char-count). Aura models accept ≤ 2000 characters.
 * Auth header: `Authorization: Token <key>`. Model names come from DEEPGRAM_STT_MODEL / DEEPGRAM_TTS_MODEL.
 * NOT verified against the live API in this build (no key available) — see TEST_REPORT.md.
 */
import { LIMITS } from '../../lib/domain/limits.ts';
import { providerFetch } from './http-call.ts';
import { ProviderError, type ProviderUsage, type SpeechToText, type TextToSpeech } from './types.ts';
import type { RateCard } from './rate-card.ts';

const BASE = 'https://api.deepgram.com/v1';

export class DeepgramSTT implements SpeechToText {
  readonly model: string;
  private key: string; private rateCard: RateCard | null;
  constructor(key: string, model: string, rateCard: RateCard | null) { this.key = key; this.model = model; this.rateCard = rateCard; }
  async transcribe(input: { audio: Uint8Array; mimeType: string; operationId: string }) {
    const url = `${BASE}/listen?model=${encodeURIComponent(this.model)}&smart_format=true&mip_opt_out=true`;
    const res = await providerFetch(url, { method: 'POST', headers: { authorization: `Token ${this.key}`, 'content-type': input.mimeType }, body: input.audio as unknown as BodyInit }, 30_000, 'deepgram_stt');
    const body: any = await res.json().catch(() => null);
    const duration = typeof body?.metadata?.duration === 'number' ? body.metadata.duration : undefined;
    const usage: ProviderUsage = {
      provider: 'deepgram', model: this.model, requestId: body?.metadata?.request_id ?? null, audioSeconds: duration,
      costStatus: duration !== undefined && this.rateCard ? 'reconciled' : 'unknown',
      actualCostMinor: duration !== undefined && this.rateCard ? this.rateCard.sttCost(this.model, duration) : null,
    };
    const text = body?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
    if (typeof text !== 'string') throw new ProviderError('failed', 'deepgram_stt_shape', 'Unexpected STT response', usage);
    return { text: text.trim(), durationSeconds: duration, usage };
  }
}

export class DeepgramTTS implements TextToSpeech {
  readonly model: string;
  private key: string; private rateCard: RateCard | null;
  constructor(key: string, model: string, rateCard: RateCard | null) { this.key = key; this.model = model; this.rateCard = rateCard; }
  async speak(input: { text: string; operationId: string }) {
    const text = input.text.slice(0, LIMITS.ttsMaxChars);
    const res = await providerFetch(`${BASE}/speak?model=${encodeURIComponent(this.model)}&mip_opt_out=true`, {
      method: 'POST', headers: { authorization: `Token ${this.key}`, 'content-type': 'application/json' }, body: JSON.stringify({ text }),
    }, 20_000, 'deepgram_tts');
    const audio = new Uint8Array(await res.arrayBuffer());
    const chars = Number(res.headers.get('dg-char-count'));
    const usage: ProviderUsage = {
      provider: 'deepgram', model: res.headers.get('dg-model-name') ?? this.model, requestId: res.headers.get('dg-request-id'),
      characters: Number.isFinite(chars) && chars > 0 ? chars : undefined,
      costStatus: Number.isFinite(chars) && chars > 0 && this.rateCard ? 'reconciled' : 'unknown',
      actualCostMinor: Number.isFinite(chars) && chars > 0 && this.rateCard ? this.rateCard.ttsCost(this.model, chars) : null,
    };
    return { audio, mimeType: (res.headers.get('content-type') ?? 'audio/mpeg').split(';')[0]!, usage };
  }
}
