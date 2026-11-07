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
} as const;

export type SessionKind = 'full' | 'drill';

export function sessionLimits(kind: SessionKind) {
  return kind === 'drill'
    ? { maxSeconds: LIMITS.drillSeconds, maxRepTurns: LIMITS.drillMaxRepTurns }
    : { maxSeconds: LIMITS.fullSessionSeconds, maxRepTurns: LIMITS.fullSessionMaxRepTurns };
}

/** Audio containers the server accepts. The browser picks one via MediaRecorder.isTypeSupported. */
export const ACCEPTED_AUDIO_MIME = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/mpeg', 'audio/aac'] as const;

export function normaliseAudioMime(mime: string): string | null {
  const base = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  return (ACCEPTED_AUDIO_MIME as readonly string[]).includes(base) ? base : null;
}
