import { LIMITS } from '../../../lib/domain/limits.ts';

export type MicState =
  | 'not_requested' | 'requesting' | 'ready' | 'recording' | 'uploading' | 'transcribing'
  | 'resident_thinking' | 'resident_speaking' | 'permission_denied' | 'unsupported' | 'failed';

export const MIC_STATE_TEXT: Record<MicState, string> = {
  not_requested: 'Microphone not enabled yet.',
  requesting: 'Waiting for microphone permission…',
  ready: 'Ready. Tap to speak (up to 30 seconds a turn).',
  recording: 'Recording… tap again to send.',
  uploading: 'Sending your turn…',
  transcribing: 'Transcribing your turn…',
  resident_thinking: 'Thinking of a reply…',
  resident_speaking: 'The customer is speaking. Microphone paused to avoid echo.',
  permission_denied: 'Microphone permission was denied. You can keep practising with typed replies, or allow the microphone in your browser settings.',
  unsupported: 'This browser cannot record audio here. Use typed replies instead.',
  failed: 'Something went wrong with the microphone. Use typed replies or try again.',
};

/** Order matters: Safari typically supports audio/mp4, Chrome/Firefox WebM/Ogg Opus. Never assume WebM. */
const CANDIDATES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/ogg;codecs=opus', 'audio/webm'];

export function recordingSupported(): boolean {
  return typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof (window as any).MediaRecorder !== 'undefined';
}

export function pickMimeType(): string | null {
  const MR = (window as any).MediaRecorder;
  if (!MR) return null;
  if (typeof MR.isTypeSupported !== 'function') return '';
  return CANDIDATES.find((m) => MR.isTypeSupported(m)) ?? null;
}

export const HANDS_FREE_RECORDING_TEXT = 'Listening… it sends when you stop talking, or tap to send now.';

/**
 * Decides when someone has finished speaking, from a stream of loudness readings (0–1).
 * The first quarter-second sets the room's background level; speech is anything clearly above it.
 * "Finished" = speech was heard for at least 0.3 s in total, then 1.4 s of quiet.
 */
export class SilenceDetector {
  private startedAt: number | null = null;
  private ambient = 0; private ambientN = 0;
  private speechMs = 0; private quietSince: number | null = null; private last: number | null = null;
  static readonly CALIBRATE_MS = 250; static readonly MIN_SPEECH_MS = 300; static readonly QUIET_MS = 1400;
  get heardSpeech() { return this.speechMs >= SilenceDetector.MIN_SPEECH_MS; }
  /** Returns true once, when the speaker has finished. */
  feed(level: number, now: number): boolean {
    this.startedAt ??= now;
    const dt = this.last === null ? 0 : now - this.last;
    this.last = now;
    if (now - this.startedAt < SilenceDetector.CALIBRATE_MS) { this.ambient += level; this.ambientN++; return false; }
    const floor = this.ambientN ? this.ambient / this.ambientN : 0;
    const threshold = Math.min(0.08, Math.max(0.02, floor * 2.5));
    if (level >= threshold) { this.speechMs += dt; this.quietSince = null; return false; }
    if (!this.heardSpeech) return false;
    this.quietSince ??= now;
    return now - this.quietSince >= SilenceDetector.QUIET_MS;
  }
}

export class TurnRecorder {
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private resolveStop: ((v: { blob: Blob; durationMs: number; mimeType: string } | null) => void) | null = null;
  private discard = false;
  onAutoStop: (() => void) | null = null;
  /** Hands-free: stop by itself when the speaker goes quiet. */
  autoStopOnSilence = false;
  private audioCtx: AudioContext | null = null;
  private meter: ReturnType<typeof setInterval> | null = null;
  private detector: SilenceDetector | null = null;
  /** Whether any speech was detected in the current/last recording (hands-free only; true otherwise). */
  get heardSpeech() { return this.detector ? this.detector.heardSpeech : true; }

  private startMeter() {
    this.detector = null;
    if (!this.autoStopOnSilence || !this.stream) return;
    try {
      const AC: typeof AudioContext | undefined = (window as any).AudioContext ?? (window as any).webkitAudioContext;
      if (!AC) return;
      this.audioCtx ??= new AC();
      void this.audioCtx.resume().catch(() => {});
      const src = this.audioCtx.createMediaStreamSource(this.stream);
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const det = new SilenceDetector();
      this.detector = det;
      this.meter = setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
        if (det.feed(Math.sqrt(sum / buf.length), performance.now())) { this.stopMeter(); try { src.disconnect(); } catch { /* ignore */ } this.onAutoStop?.(); }
      }, 80);
    } catch { this.detector = null; }
  }
  private stopMeter() { if (this.meter) { clearInterval(this.meter); this.meter = null; } }

  /** Must be called from a user gesture. */
  async requestPermission(): Promise<'ready' | 'permission_denied' | 'unsupported' | 'failed'> {
    if (!recordingSupported()) return 'unsupported';
    if (pickMimeType() === null) return 'unsupported';
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      return 'ready';
    } catch (e: any) {
      if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') return 'permission_denied';
      if (e?.name === 'NotFoundError' || e?.name === 'NotSupportedError') return 'unsupported';
      return 'failed';
    }
  }

  get hasStream() { return !!this.stream && this.stream.getAudioTracks().some((t) => t.readyState === 'live'); }

  start() {
    if (!this.stream) throw new Error('No microphone stream');
    const mime = pickMimeType();
    this.chunks = [];
    this.discard = false;
    this.rec = mime ? new MediaRecorder(this.stream, { mimeType: mime }) : new MediaRecorder(this.stream);
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.onstop = () => {
      const durationMs = Date.now() - this.startedAt;
      const type = this.rec?.mimeType || mime || 'audio/webm';
      const out = this.discard ? null : { blob: new Blob(this.chunks, { type }), durationMs, mimeType: type };
      this.chunks = [];
      this.resolveStop?.(out);
      this.resolveStop = null;
    };
    this.startedAt = Date.now();
    this.rec.start();
    this.startMeter();
    this.timer = setTimeout(() => this.onAutoStop?.(), LIMITS.recordingMaxSeconds * 1000);
  }

  stop(): Promise<{ blob: Blob; durationMs: number; mimeType: string } | null> {
    if (this.timer) clearTimeout(this.timer);
    this.stopMeter();
    if (!this.rec || this.rec.state === 'inactive') return Promise.resolve(null);
    return new Promise((resolve) => { this.resolveStop = resolve; this.rec!.stop(); });
  }

  /** Stop without sending (e.g. page backgrounded) — prevents a half-recorded duplicate turn. */
  async cancel() { this.discard = true; await this.stop(); }

  release() {
    if (this.timer) clearTimeout(this.timer);
    this.stopMeter();
    void this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
    try { if (this.rec && this.rec.state !== 'inactive') { this.discard = true; this.rec.stop(); } } catch { /* ignore */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.rec = null;
  }
}
