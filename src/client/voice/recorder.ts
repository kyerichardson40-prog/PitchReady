import { LIMITS } from '../../../lib/domain/limits.ts';

export type MicState =
  | 'not_requested' | 'requesting' | 'ready' | 'recording' | 'uploading' | 'transcribing'
  | 'resident_thinking' | 'resident_speaking' | 'permission_denied' | 'unsupported' | 'failed';

export const MIC_STATE_TEXT: Record<MicState, string> = {
  not_requested: 'Microphone not enabled yet.',
  requesting: 'Waiting for microphone permission…',
  ready: 'Ready. Hold a short turn (up to 30 seconds).',
  recording: 'Recording… tap again to send.',
  uploading: 'Sending your turn…',
  transcribing: 'Transcribing your turn…',
  resident_thinking: 'Thinking of a reply…',
  resident_speaking: 'Speaking — microphone paused to avoid echo.',
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

export class TurnRecorder {
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private resolveStop: ((v: { blob: Blob; durationMs: number; mimeType: string } | null) => void) | null = null;
  private discard = false;
  onAutoStop: (() => void) | null = null;

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
    this.timer = setTimeout(() => this.onAutoStop?.(), LIMITS.recordingMaxSeconds * 1000);
  }

  stop(): Promise<{ blob: Blob; durationMs: number; mimeType: string } | null> {
    if (this.timer) clearTimeout(this.timer);
    if (!this.rec || this.rec.state === 'inactive') return Promise.resolve(null);
    return new Promise((resolve) => { this.resolveStop = resolve; this.rec!.stop(); });
  }

  /** Stop without sending (e.g. page backgrounded) — prevents a half-recorded duplicate turn. */
  async cancel() { this.discard = true; await this.stop(); }

  release() {
    if (this.timer) clearTimeout(this.timer);
    try { if (this.rec && this.rec.state !== 'inactive') { this.discard = true; this.rec.stop(); } } catch { /* ignore */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.rec = null;
  }
}
