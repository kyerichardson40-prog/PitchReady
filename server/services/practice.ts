import { getScenario } from '../../lib/content/scenarios.ts';
import { siteSettings } from '../site-settings.ts';
import { nextSpeakableEnd, speakableChunks } from '../../lib/ai/stream-text.ts';
import { LIMITS, limitsOfSession, normaliseAudioMime } from '../../lib/domain/limits.ts';
import { residentDirective } from '../../lib/domain/session-rules.ts';
import { transcriptAtRevision } from '../../lib/domain/transcript.ts';
import type { CampaignPack, PracticeSession, Scenario } from '../../lib/domain/types.ts';
import { getDb } from '../db.ts';
import { ApiError } from '../http.ts';
import { getProviders, type Providers } from '../providers/index.ts';
import { ProviderError } from '../providers/types.ts';
import type { AuthUser } from '../auth.ts';
import { metered } from './metered.ts';
import { runEvaluationJob } from './evaluation.ts';

export interface TurnResponse { session: PracticeSession; residentAudio: { base64: string; mimeType: string } | null; notices: string[]; streamed?: boolean }

/**
 * Live updates while a turn is processed (the browser asks for them with Accept: application/x-ndjson):
 * the rep's words once saved, the customer's reply as it is written, then its voice one sentence
 * at a time, in order. Without them, the turn returns in one go as before.
 */
export interface TurnEvents {
  rep?(session: PracticeSession): void;
  partial?(text: string): void;
  audio?(index: number, audio: { base64: string; mimeType: string }): void;
}

function requireProviders(): Providers {
  const p = getProviders();
  if (!p) throw new ApiError(503, 'ai_not_configured', 'Practice is not available yet: the AI providers and spend limits have not been configured for this pilot.');
  return p;
}

async function speak(p: Providers, sessionId: string, text: string, opId: string, notices: string[]) {
  if (!p.tts || !text || !(await siteSettings()).voiceEnabled) return null;
  try {
    const out = await metered(p, { sessionId, operationId: opId, operation: 'tts', model: p.tts.model, sizeHint: text.length }, () => p.tts!.speak({ text, operationId: opId }));
    return { base64: Buffer.from(out.audio).toString('base64'), mimeType: out.mimeType };
  } catch {
    notices.push('The customer’s voice is unavailable right now; the reply is shown as text.');
    return null;
  }
}

/**
 * Voices the customer's reply one sentence at a time while it is being written. Each sentence is
 * sent for speech as soon as it is complete; the clips are passed on strictly in order.
 */
class SentenceVoice {
  private spoken = 0; private index = 0; private chain: Promise<void> = Promise.resolve(); private cancelled = false; private lastText = '';
  private p: Providers; private sessionId: string; private requestId: string; private notices: string[]; private events: TurnEvents;
  constructor(p: Providers, sessionId: string, requestId: string, notices: string[], events: TurnEvents) {
    this.p = p; this.sessionId = sessionId; this.requestId = requestId; this.notices = notices; this.events = events;
  }
  feed(soFar: string) {
    const text = soFar.slice(0, LIMITS.residentUtteranceMaxChars);
    if (text !== this.lastText) { this.lastText = text; this.events.partial?.(text); }
    for (let end = nextSpeakableEnd(text, this.spoken, this.spoken === 0); end !== null; end = nextSpeakableEnd(text, this.spoken, false)) {
      this.say(text.slice(this.spoken, end));
      this.spoken = end;
    }
  }
  /** After the reply is complete: voices whatever hasn't been, then waits for every clip to be passed on. */
  async finish(utterance: string) {
    if (this.spoken === 0) for (const chunk of speakableChunks(utterance)) { this.say(chunk); }
    else if (utterance.startsWith(this.lastText.slice(0, this.spoken))) this.say(utterance.slice(this.spoken));
    this.spoken = utterance.length;
    await this.chain;
  }
  cancel() { this.cancelled = true; }
  private say(text: string) {
    const t = text.trim();
    if (!t || this.cancelled) return;
    const i = this.index++;
    const pending = this.notices.length;
    const audio = speak(this.p, this.sessionId, t, `tts:${this.sessionId}:${this.requestId}:${i}`, this.notices);
    this.chain = this.chain.then(async () => {
      const a = await audio;
      // One "voice unavailable" notice is enough, however many sentences failed.
      const msg = this.notices[pending];
      if (msg && this.notices.indexOf(msg) < pending) this.notices.splice(pending, 1);
      if (a && !this.cancelled) this.events.audio?.(i, a);
    });
  }
}

export async function startSession(user: AuthUser, input: { scenarioKey: string; drillKey?: string | null; parentSessionId?: string | null; idempotencyKey: string }): Promise<TurnResponse> {
  const p = requireProviders();
  const db = getDb().user(user.accessToken, user.id);
  let session = await db.rpc<PracticeSession>('start_session', {
    scenario_key: input.scenarioKey, drill_key: input.drillKey ?? null, parent_session_id: input.parentSessionId ?? null, request_id: input.idempotencyKey,
  });
  const notices: string[] = [];
  let residentAudio = null;
  if (session.status === 'created') {
    // The clock starts only once the opening line (and its audio, if enabled) is ready.
    residentAudio = await speak(p, session.id, session.turns[0]?.text ?? '', `tts:${session.id}:opener`, notices);
    session = await db.rpc<PracticeSession>('activate_session', { session_id: session.id });
  }
  return { session, residentAudio, notices };
}

export async function submitTurn(user: AuthUser, sessionId: string, input:
  | { kind: 'typed'; text: string; expectedSequence: number; idempotencyKey: string }
  | { kind: 'audio'; audio: Uint8Array; mimeType: string; expectedSequence: number; idempotencyKey: string; durationMs?: number },
  events?: TurnEvents,
): Promise<TurnResponse> {
  const p = requireProviders();
  const db = getDb().user(user.accessToken, user.id);
  const svc = getDb().service();
  const notices: string[] = [];
  let text: string;
  let source: 'typed' | 'transcribed' = 'typed';

  if (input.kind === 'audio') {
    if (!p.stt || !(await siteSettings()).voiceEnabled) throw new ApiError(503, 'voice_unavailable', 'Voice is switched off at the moment; please type your reply.');
    const mime = normaliseAudioMime(input.mimeType);
    if (!mime) throw new ApiError(415, 'unsupported_audio', 'This recording format is not supported. Please type your reply.');
    if (input.audio.byteLength > LIMITS.audioMaxBytes) throw new ApiError(413, 'audio_too_large', 'That recording is too large. Record a shorter turn (under 30 seconds) or type it.');
    if (input.audio.byteLength < 100) throw new ApiError(422, 'audio_too_short', 'That recording was too short. Try again or type your reply.');
    const begun = await db.rpc<{ ok: boolean; duplicate: boolean; code?: string; session?: PracticeSession }>('begin_turn', { session_id: sessionId, expected_sequence: input.expectedSequence, request_id: input.idempotencyKey });
    if (!begun.ok) return { session: begun.session!, residentAudio: null, notices: ['Time was up before that turn arrived.'] };
    if (begun.duplicate) return continueResident(p, user, begun.session!, input.idempotencyKey, notices, events);
    try {
      const out = await metered(p, { sessionId, operationId: `stt:${sessionId}:${input.idempotencyKey}`, operation: 'stt', model: p.stt.model, sizeHint: Math.ceil((input.durationMs ?? LIMITS.recordingMaxSeconds * 1000) / 1000) },
        () => p.stt!.transcribe({ audio: input.audio, mimeType: mime, operationId: input.idempotencyKey }));
      text = out.text.slice(0, LIMITS.typedTurnMaxChars);
    } catch (e) {
      await svc.rpc('release_turn', { session_id: sessionId, request_id: input.idempotencyKey }).catch(() => undefined);
      if (e instanceof ApiError) throw e;
      throw new ApiError(502, 'transcription_failed', 'We could not transcribe that turn. Please record again or type your reply. Nothing was added to the transcript.');
    }
    if (!text.trim()) {
      await svc.rpc('release_turn', { session_id: sessionId, request_id: input.idempotencyKey }).catch(() => undefined);
      throw new ApiError(422, 'no_speech', 'No speech was detected. Try again closer to the microphone, or type your reply.');
    }
    source = 'transcribed';
  } else {
    text = input.text;
  }

  const committed = await db.rpc<{ ok: boolean; duplicate: boolean; code?: string; session: PracticeSession }>('commit_rep_turn', {
    session_id: sessionId, expected_sequence: input.expectedSequence, request_id: input.idempotencyKey, text, source,
  });
  if (!committed.ok) {
    await runEvaluationJob(sessionId).catch(() => undefined);
    return { session: (await db.rpc<any>('get_session', { session_id: sessionId })).session, residentAudio: null, notices: ['Time was up before that turn arrived.'] };
  }
  events?.rep?.(committed.session);
  return continueResident(p, user, committed.session, input.idempotencyKey, notices, events);
}

/** Produces (or resumes) the resident reply for a committed rep turn. Safe to call again with the same request ID. */
async function continueResident(p: Providers, user: AuthUser, session: PracticeSession, requestId: string, notices: string[], events?: TurnEvents): Promise<TurnResponse> {
  const svc = getDb().service();
  const db = getDb().user(user.accessToken, user.id);
  const last = session.turns.at(-1);
  if (session.status !== 'active' || last?.speaker !== 'rep') return { session, residentAudio: null, notices };

  const transcript = transcriptAtRevision(session.turns, [], 1);
  const directive = residentDirective({ scenarioKey: session.scenarioKey, drillKey: session.drillKey, transcript, maxRepTurns: limitsOfSession(session).maxRepTurns });
  if (directive.kind === 'end') {
    const ended = await svc.rpc<PracticeSession>('commit_resident_turn', { session_id: session.id, request_id: requestId, text: null, end: true, end_reason: directive.reason === 'turn_limit' ? 'turn_limit' : 'resident_ended' });
    await runEvaluationJob(session.id).catch(() => undefined);
    return { session: await refreshed(db, ended), residentAudio: null, notices };
  }

  const ctxData: any = await db.rpc('my_context');
  // The agency's version of the scenario (built-in or manager-written). If it was unassigned or archived
  // mid-session, fall back to the built-in copy or a neutral resident built from the session itself.
  const scenario: Scenario = (ctxData.scenarios as Scenario[] | undefined)?.find((x) => x.key === session.scenarioKey)
    ?? getScenario(session.scenarioKey)
    ?? { key: session.scenarioKey, version: 1, title: session.scenarioTitle ?? session.scenarioKey, persona: 'A customer', opener: session.turns[0]?.text ?? '', objection: 'Not stated', goal: 'Have a short, respectful conversation.', allowedEnding: 'A courteous ending.', behaviour: 'Polite and brief.', skill: 'General' };
  const campaign = ctxData.campaign?.pack as CampaignPack;
  let reply: { utterance: string; endConversation: boolean; reason: string | null };
  const voice = events ? new SentenceVoice(p, session.id, requestId, notices, events) : null;
  try {
    const opId = `resident:${session.id}:${requestId}`;
    const ctxIn = { scenario, drillKey: session.drillKey, campaign, transcript, repliesLeft: limitsOfSession(session).maxRepTurns - transcript.filter((t) => t.speaker === 'rep').length, operationId: opId };
    reply = await metered(p, { sessionId: session.id, operationId: opId, operation: 'resident', model: p.resident.model, sizeHint: JSON.stringify(transcript).length },
      () => (voice && p.resident.replyStream ? p.resident.replyStream(ctxIn, (soFar) => voice.feed(soFar)) : p.resident.reply(ctxIn)));
  } catch (e) {
    voice?.cancel();
    // Documented policy (ARCHITECTURE.md): a resident outage stops practice and refunds the session's allowance.
    // Uncertain attempts are recorded, never silently reissued.
    if (e instanceof ApiError && e.code === 'operation_in_progress') throw e;
    const failed = await svc.rpc<PracticeSession>('fail_session', { session_id: session.id });
    const msg = e instanceof ProviderError && e.kind === 'uncertain'
      ? 'The AI customer did not respond in time, so this practice was stopped. Your transcript is saved and no allowance was used.'
      : 'The AI customer is unavailable right now, so this practice was stopped. Your transcript is saved and no allowance was used.';
    return { session: failed, residentAudio: null, notices: [msg] };
  }
  const utterance = reply.utterance.slice(0, LIMITS.residentUtteranceMaxChars);
  const after = await svc.rpc<PracticeSession>('commit_resident_turn', { session_id: session.id, request_id: requestId, text: utterance, end: reply.endConversation, end_reason: 'resident_ended', source: p.kind === 'mock' ? 'scripted' : 'generated' });
  if (voice) {
    // Streaming: the rest of the reply is voiced (including a goodbye line), sentence by sentence.
    events!.partial?.(utterance);
    await voice.finish(utterance);
    if (after.status !== 'active') await runEvaluationJob(session.id).catch(() => undefined);
    return { session: await refreshed(db, after), residentAudio: null, notices, streamed: true };
  }
  let residentAudio = null;
  if (after.status === 'active') residentAudio = await speak(p, session.id, utterance, `tts:${session.id}:${requestId}`, notices);
  else await runEvaluationJob(session.id).catch(() => undefined);
  return { session: await refreshed(db, after), residentAudio, notices };
}

async function refreshed(db: ReturnType<ReturnType<typeof getDb>['user']>, s: PracticeSession): Promise<PracticeSession> {
  if (s.status === 'active') return s;
  const r: any = await db.rpc('get_session', { session_id: s.id });
  return r?.session ?? s;
}

export async function endSession(user: AuthUser, sessionId: string): Promise<PracticeSession> {
  const db = getDb().user(user.accessToken, user.id);
  const s = await db.rpc<PracticeSession>('end_session', { session_id: sessionId });
  // Bounded, awaited evaluation attempt; if it doesn't finish, the durable job stays for the worker.
  if (s.evaluationStatus === 'pending') await runEvaluationJob(sessionId).catch(() => undefined);
  const r: any = await db.rpc('get_session', { session_id: sessionId });
  return r?.session ?? s;
}

export async function evaluateNow(user: AuthUser, sessionId: string): Promise<PracticeSession> {
  const db = getDb().user(user.accessToken, user.id);
  await db.rpc('request_evaluation', { session_id: sessionId });
  await runEvaluationJob(sessionId).catch(() => undefined);
  const r: any = await db.rpc('get_session', { session_id: sessionId });
  if (!r) throw new ApiError(404, 'not_found', 'Session not found.');
  return r.session;
}
