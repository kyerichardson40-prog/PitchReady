/** Server-owned practice limits. Browser timers only display these. */
export const LIMITS = {
  fullSessionSeconds: 180,
  drillSeconds: 60,
  fullSessionMaxRepTurns: 12,
  drillMaxRepTurns: 5,
  recordingMaxSeconds: 30,
  audioMaxBytes: 10 * 1024 * 1024,
  typedTurnMaxChars: 1200,
  residentUtteranceMaxChars: 400,
  /** Seconds after the deadline before a still-open session is treated as abandoned by maintenance. */
  abandonGraceSeconds: 120,
  evaluationMaxAttempts: 3,
  evaluationLeaseSeconds: 90,
  ttsMaxChars: 2000,
  /** Most AI processing time credited back to the clock for one turn (speech-to-text + reply + voice). */
  pauseCreditMaxSeconds: 90,
} as const;

/** Full-session lengths a manager can choose (campaign pack `practice_minutes`); replies scale with time. */
export const PRACTICE_MINUTES = [3, 5, 10] as const;
export type PracticeMinutes = (typeof PRACTICE_MINUTES)[number];
export const DEFAULT_PRACTICE_MINUTES: PracticeMinutes = 3;
const REP_TURNS_FOR_MINUTES: Record<PracticeMinutes, number> = { 3: 12, 5: 20, 10: 40 };

export function practiceMinutesOf(pack: { practice_minutes?: number } | null | undefined): PracticeMinutes {
  const m = pack?.practice_minutes;
  return (PRACTICE_MINUTES as readonly number[]).includes(m as number) ? (m as PracticeMinutes) : DEFAULT_PRACTICE_MINUTES;
}

export type SessionKind = 'full' | 'drill';

/** Limits for a new session. Drills are always 60 seconds; full sessions follow the campaign's practice length. */
export function sessionLimits(kind: SessionKind, minutes: PracticeMinutes = DEFAULT_PRACTICE_MINUTES) {
  return kind === 'drill'
    ? { maxSeconds: LIMITS.drillSeconds, maxRepTurns: LIMITS.drillMaxRepTurns }
    : { maxSeconds: minutes * 60, maxRepTurns: REP_TURNS_FOR_MINUTES[minutes] };
}

/** Limits of an existing session: the values frozen on it, falling back to the defaults for its kind. */
export function limitsOfSession(s: { kind: SessionKind; maxSeconds?: number | null; maxRepTurns?: number | null }) {
  const d = sessionLimits(s.kind);
  return { maxSeconds: s.maxSeconds ?? d.maxSeconds, maxRepTurns: s.maxRepTurns ?? d.maxRepTurns };
}

/** Audio containers the server accepts. The browser picks one via MediaRecorder.isTypeSupported. */
export const ACCEPTED_AUDIO_MIME = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/mpeg', 'audio/aac'] as const;

export function normaliseAudioMime(mime: string): string | null {
  const base = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  return (ACCEPTED_AUDIO_MIME as readonly string[]).includes(base) ? base : null;
}
