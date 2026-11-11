'use client';
import { useCustomer } from '../customer.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getDrill, getScenario } from '../../../lib/content/scenarios.ts';
import { LIMITS, limitsOfSession, sessionLimits } from '../../../lib/domain/limits.ts';
import type { DrillKey, PracticeSession, ScenarioKey } from '../../../lib/domain/types.ts';
import { newKey, useApp } from '../app-context.tsx';
import { useNavigate, useLocation } from '../router.tsx';
import { RepoError, type TurnEvents, type TurnResult } from '../repo/types.ts';
import { ErrorBox, FictionalTag } from '../components/ui.tsx';
import { Transcript } from '../components/Transcript.tsx';
import { HANDS_FREE_RECORDING_TEXT, MIC_STATE_TEXT, TurnRecorder, recordingSupported, type MicState } from '../voice/recorder.ts';

export function PracticeSessionPage({ scenarioId }: { scenarioId: string }) {
  const navigate = useNavigate();
  const { repo, ctx, refresh } = useApp();
  const customer = useCustomer();
  const { search } = useLocation();
  const qs = new URLSearchParams(search);
  const drillKey = (qs.get('drill') || null) as DrillKey | null;
  const parentId = qs.get('parent');
  // The agency's scenarios (built-in or written by the manager), as allowed for this rep.
  const scenario = ctx?.scenarios.find((x) => x.key === scenarioId) ?? (drillKey ? getScenario(scenarioId) : undefined);
  const drill = drillKey ? getDrill(drillKey) : null;

  const [session, setSession] = useState<PracticeSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [mic, setMic] = useState<MicState>('not_requested');
  const [deviceVoice, setDeviceVoice] = useState(false);
  const [tapToPlay, setTapToPlay] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  /** While the AI works on a reply the server pauses the clock; the display freezes at this moment. */
  const [pausedAt, setPausedAt] = useState<number | null>(null);

  /** The customer's reply while it is still being written (streamed turns). */
  const [partial, setPartial] = useState<string | null>(null);
  // Sentence clips of the current reply, played one after another as they arrive.
  const clips = useRef<string[]>([]);
  const clipPlaying = useRef(false);
  const replyDone = useRef(true);
  const afterSpeechWaiters = useRef<(() => void)[]>([]);

  const recorder = useRef<TurnRecorder | null>(null);
  const audioUrl = useRef<string | null>(null);
  const audioEl = useRef<HTMLAudioElement | null>(null);
  const pendingKey = useRef<string | null>(null);
  const startKey = useRef<string>(newKey('start'));
  const ending = useRef(false);

  const sttEnabled = ctx?.voice.stt ?? false;

  // Hands-free: listen again after the customer speaks, and send when the rep stops talking.
  const [handsFree, setHandsFreeState] = useState(() => { try { return localStorage.getItem('pr-handsfree') !== '0'; } catch { return true; } });
  const handsFreeRef = useRef(handsFree);
  const setHandsFree = (on: boolean) => { handsFreeRef.current = on; setHandsFreeState(on); try { localStorage.setItem('pr-handsfree', on ? '1' : '0'); } catch { /* private mode */ } };
  const startListening = useRef<() => void>(() => {});

  // Release every media resource on unmount.
  useEffect(() => () => {
    for (const u of clips.current) URL.revokeObjectURL(u);
    clips.current = [];
    recorder.current?.release();
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    audioEl.current?.pause();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }, []);

  // Display-only countdown; the server/engine owns the real deadline.
  useEffect(() => {
    if (!session || session.status !== 'active') return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [session]);

  // Backgrounding: discard an in-progress recording instead of sending a partial duplicate.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden' && mic === 'recording') {
        void recorder.current?.cancel();
        setMic('ready');
        setNotice('Recording stopped because the page was hidden. Nothing was sent.');
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [mic]);

  const finish = useCallback(async (s: PracticeSession) => {
    await refresh();
    navigate(`/sessions/${encodeURIComponent(s.id)}`);
  }, [refresh]);

  /** The customer has finished speaking (all clips played, or skipped): back to the rep. */
  const afterSpeech = useCallback(() => {
    setMic((m) => (m === 'permission_denied' || m === 'unsupported' || m === 'recording' ? m : recorder.current?.hasStream ? 'ready' : 'not_requested'));
    const waiters = afterSpeechWaiters.current; afterSpeechWaiters.current = [];
    waiters.forEach((w) => w());
    if (handsFreeRef.current && recorder.current?.hasStream) setTimeout(() => startListening.current(), 250);
  }, []);

  const playNextClip = useCallback(() => {
    const url = clips.current.shift();
    if (!url) { clipPlaying.current = false; if (replyDone.current) afterSpeech(); return; }
    clipPlaying.current = true;
    const el = audioEl.current ?? new Audio();
    audioEl.current = el;
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    audioUrl.current = url;
    el.src = url;
    el.onended = () => playNextClip();
    setMic((m) => (m === 'permission_denied' || m === 'unsupported' ? m : 'resident_speaking'));
    el.play().then(() => setTapToPlay(null)).catch(() => {
      // Autoplay blocked: the button below plays this clip, and the rest follow on.
      clipPlaying.current = false;
      clips.current.unshift(url);
      audioUrl.current = null;
      setTapToPlay('…');
    });
  }, [afterSpeech]);

  const queueClip = useCallback((a: { base64: string; mimeType: string }) => {
    const bytes = Uint8Array.from(atob(a.base64), (c) => c.charCodeAt(0));
    clips.current.push(URL.createObjectURL(new Blob([bytes], { type: a.mimeType })));
    if (!clipPlaying.current) playNextClip();
  }, [playNextClip]);

  /** Live updates for one turn: the rep's words, the reply as it's written, and its voice. */
  const turnEvents = useCallback((): TurnEvents => {
    replyDone.current = false;
    return {
      rep: (s) => { setSession(s); setMic((m) => (m === 'transcribing' || m === 'uploading' || m === 'ready' || m === 'not_requested' ? 'resident_thinking' : m)); },
      partial: (t) => setPartial(t),
      audio: (_i, a) => queueClip(a),
    };
  }, [queueClip]);

  /** Typed turns: also empty the reply box as soon as the reply is saved. */
  const withClearedInput = (ev: TurnEvents): TurnEvents => ({ ...ev, rep: (s) => { ev.rep?.(s); setText(''); } });

  const speakResident = useCallback(async (r: TurnResult, prevCount: number) => {
    const newResident = r.session.turns.slice(prevCount).filter((t) => t.speaker === 'resident').at(-1);
    if (!newResident) return;
    if (r.residentAudio) {
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
      const bytes = Uint8Array.from(atob(r.residentAudio.base64), (c) => c.charCodeAt(0));
      audioUrl.current = URL.createObjectURL(new Blob([bytes], { type: r.residentAudio.mimeType }));
      const el = audioEl.current ?? new Audio();
      audioEl.current = el;
      el.src = audioUrl.current;
      el.onended = () => {
        setMic((m) => (m === 'resident_speaking' ? (recorder.current?.hasStream ? 'ready' : 'not_requested') : m));
        // Short gap so the tail of the customer's voice isn't picked up.
        if (handsFreeRef.current && recorder.current?.hasStream) setTimeout(() => startListening.current(), 250);
      };
      setMic((m) => (m === 'permission_denied' || m === 'unsupported' ? m : 'resident_speaking'));
      try { await el.play(); setTapToPlay(null); }
      catch { setTapToPlay(newResident.text); setMic(recorder.current?.hasStream ? 'ready' : 'not_requested'); }
    } else if (deviceVoice && typeof speechSynthesis !== 'undefined') {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(newResident.text);
      u.lang = 'en-GB';
      speechSynthesis.speak(u);
    }
  }, [deviceVoice]);

  const handleResult = useCallback(async (r: TurnResult, prevCount: number) => {
    setSession(r.session);
    setPartial(null);
    if (r.notices.length) setNotice(r.notices.join(' '));
    if (r.streamed) {
      replyDone.current = true;
      const speaking = clipPlaying.current || clips.current.length > 0;
      if (r.session.status !== 'active') {
        // Let the customer finish their last line (up to 15 seconds) before showing the feedback.
        if (speaking) await new Promise<void>((res) => { afterSpeechWaiters.current.push(res); setTimeout(res, 15_000); });
        await finish(r.session);
        return;
      }
      if (!speaking) afterSpeech();
      return;
    }
    if (r.session.status !== 'active') { await finish(r.session); return; }
    await speakResident(r, prevCount);
  }, [finish, speakResident]);

  const handleError = useCallback(async (e: unknown) => {
    const err = e instanceof RepoError ? e : new RepoError('unknown', 'Something went wrong.');
    if (err.code === 'stale_sequence' && session) {
      const fresh = await repo.getSession(session.id).catch(() => null);
      if (fresh) setSession(fresh.session);
      pendingKey.current = null;
    }
    if (err.code === 'deadline_passed' || err.code === 'session_closed' || err.code === 'membership_inactive') {
      if (session) { await finish(session); return; }
    }
    setError(`${err.message}${err.requestId ? ` (ref ${err.requestId})` : ''}`);
  }, [repo, session, finish]);

  const start = async () => {
    setBusy(true); setError(null);
    try {
      const r = await repo.startSession({ scenarioKey: (drill?.baseScenario ?? scenarioId) as ScenarioKey, drillKey, parentSessionId: parentId, idempotencyKey: startKey.current });
      await refresh();
      await handleResult(r, 0);
    } catch (e) { await handleError(e); }
    finally { setBusy(false); }
  };

  const sendTyped = async () => {
    if (!session || busy || !text.trim()) return;
    setBusy(true); setError(null); setNotice(null); setPausedAt(Date.now());
    pendingKey.current ??= newKey('turn');
    const prev = session.turns.length;
    try {
      setMic((m) => (m === 'ready' || m === 'not_requested' ? 'resident_thinking' : m));
      const r = await repo.submitTypedTurn(session.id, { text: text.trim(), expectedSequence: prev + 1, idempotencyKey: pendingKey.current }, withClearedInput(turnEvents()));
      pendingKey.current = null;
      setText('');
      if (!r.streamed) setMic(recorder.current?.hasStream ? 'ready' : 'not_requested');
      await handleResult(r, prev);
    } catch (e) {
      setPartial(null); replyDone.current = true;
      setMic(recorder.current?.hasStream ? 'ready' : 'not_requested');
      await handleError(e); // pendingKey is kept so a retry cannot create a duplicate turn
    } finally { setBusy(false); setPausedAt(null); }
  };

  const enableMic = async () => {
    recorder.current ??= new TurnRecorder();
    setMic('requesting');
    const res = await recorder.current.requestPermission();
    setMic(res);
  };

  const beginRecording = () => {
    if (!recorder.current) return;
    recorder.current.autoStopOnSilence = handsFreeRef.current;
    recorder.current.onAutoStop = () => { void toggleRecordStop(true); };
    try { recorder.current.start(); setMic('recording'); } catch { setMic('failed'); }
  };
  // Called after the customer finishes speaking (hands-free); only starts if the mic is idle.
  startListening.current = () => { if (session?.status === 'active' && mic !== 'recording' && !busy && document.visibilityState === 'visible') beginRecording(); };

  const skipCustomer = () => {
    audioEl.current?.pause();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    for (const u of clips.current) URL.revokeObjectURL(u);
    clips.current = [];
    clipPlaying.current = false;
    if (replyDone.current) afterSpeech();
    else setMic(recorder.current?.hasStream ? 'ready' : 'not_requested');
  };

  const toggleRecord = async () => {
    if (!session || !recorder.current) return;
    if (mic === 'ready') {
      beginRecording();
    } else if (mic === 'recording') {
      await toggleRecordStop();
    }
  };

  const toggleRecordStop = async (auto = false) => {
    if (!session || !recorder.current) return;
    // Hands-free and nothing was said before the time limit: don't send silence.
    if (auto && recorder.current.autoStopOnSilence && !recorder.current.heardSpeech) {
      await recorder.current.cancel(); setMic('ready'); setNotice('We didn’t hear anything, so nothing was sent. Tap to speak when you’re ready.'); return;
    }
    const out = await recorder.current.stop();
    if (!out) { setMic('ready'); return; }
    if (out.blob.size > LIMITS.audioMaxBytes) { setMic('ready'); setError('That recording was too large to send. Please record a shorter turn, or type it.'); return; }
    if (out.blob.size < 800) { setMic('ready'); setNotice('That recording was too short to transcribe. Try again or type your reply.'); return; }
    setBusy(true); setError(null); setMic('uploading'); setPausedAt(Date.now());
    pendingKey.current ??= newKey('turn');
    const prev = session.turns.length;
    try {
      setMic('transcribing');
      const r = await repo.submitAudioTurn(session.id, out.blob, { expectedSequence: prev + 1, idempotencyKey: pendingKey.current, durationMs: out.durationMs }, turnEvents());
      pendingKey.current = null;
      if (!r.streamed) setMic('ready');
      await handleResult(r, prev);
    } catch (e) {
      setPartial(null); replyDone.current = true;
      setMic('ready');
      await handleError(e);
    } finally { setBusy(false); setPausedAt(null); }
  };

  const end = useCallback(async () => {
    if (!session || ending.current) return;
    ending.current = true;
    recorder.current?.release();
    setBusy(true);
    try { const s = await repo.endSession(session.id, { idempotencyKey: `end-${session.id}` }); await finish(s); }
    catch (e) { ending.current = false; await handleError(e); }
    finally { setBusy(false); }
  }, [session, repo, finish, handleError]);

  const shownNow = pausedAt ?? now;
  const remaining = session?.deadlineAt ? Math.max(0, Math.ceil((new Date(session.deadlineAt).getTime() - shownNow) / 1000)) : null;
  useEffect(() => { if (remaining === 0 && session?.status === 'active') void end(); }, [remaining, session, end]);

  if (!scenario) return <ErrorBox message="This scenario isn’t in your practice list. Choose one from Practise." />;
  if (ctx?.user?.role !== 'rep') return <ErrorBox message="Practice is available in the rep view." />;
  const limits = session ? limitsOfSession(session) : sessionLimits(drill ? 'drill' : 'full', ctx?.campaign?.practiceMinutes);
  const repTurns = session?.turns.filter((t) => t.speaker === 'rep').length ?? 0;

  if (!session) {
    return (
      <div className="stack">
        <div className="row"><FictionalTag />{drill && <span className="tag teal">Retry drill · {limits.maxSeconds}s</span>}</div>
        <h1>{drill ? `Drill: ${drill.title}` : scenario.title}</h1>
        <div className="card">
          <h2>Objective</h2>
          <p>{drill ? drill.objective : scenario.goal}</p>
          <p className="small muted">{customer.Label}: {drill ? `a ${customer.label}` : scenario.persona} · {customer.channel.short}. A good outcome can be a respectful ending — you don’t need to make the sale to score well.</p>
        </div>
        <div className="alert info">
          <p style={{ margin: 0 }}><strong>Before you start:</strong> this is a simulated practice conversation. Your agency’s managers can review saved practice transcripts and feedback. Voice recordings are not kept{repo.mode === 'demo' ? '; in demo mode nothing leaves this browser' : ''}.</p>
        </div>
        <div className="card">
          <h2>Time and turns</h2>
          <p>Up to {limits.maxSeconds / 60 >= 1 ? `${limits.maxSeconds / 60} minutes` : `${limits.maxSeconds} seconds`} and up to {limits.maxRepTurns} replies. The clock starts when the {customer.label}’s first line is ready, pauses while the {customer.label} is thinking of a reply, and can’t be reset by reloading.</p>
          <h3>Device check</h3>
          {sttEnabled ? (
            <p className="small">{recordingSupported() ? 'This browser can record audio. You will be asked for microphone permission when you tap “Enable microphone”.' : MIC_STATE_TEXT.unsupported}</p>
          ) : (
            <p className="small">{repo.mode === 'demo' ? 'Voice transcription is not used in demo mode — you’ll type your replies. Nothing you type is sent anywhere.' : 'Voice is not configured for this pilot yet — you’ll type your replies.'}</p>
          )}
          {repo.mode === 'demo' && typeof speechSynthesis !== 'undefined' && (
            <label className="row" style={{ fontWeight: 500 }}>
              <input type="checkbox" checked={deviceVoice} onChange={(e) => setDeviceVoice(e.target.checked)} style={{ width: 24, minHeight: 24 }} />
              Read the {customer.label}’s lines aloud with this device’s built-in voice
            </label>
          )}
        </div>
        {error && <ErrorBox message={error} />}
        <button className="btn primary big" onClick={start} disabled={busy}>{busy ? 'Starting…' : 'Start practice'}</button>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="spread">
        <div>
          <h1 style={{ marginBottom: 0 }}>{drill ? `Drill: ${drill.title}` : scenario.title}</h1>
          <span className="small muted">{repTurns}/{limits.maxRepTurns} replies · simulated {customer.label}{repo.mode === 'demo' ? (ctx?.liveAi ? ' (Claude, live)' : ' (scripted demo)') : ''}</span>
        </div>
        <div aria-live="off" className={`timer ${remaining !== null && remaining <= 20 ? 'low' : ''} ${pausedAt ? 'paused' : ''}`} aria-label={pausedAt ? 'Time remaining (paused while the reply is prepared)' : 'Time remaining'} title={pausedAt ? 'Paused while the reply is prepared' : undefined}>
          {remaining === null ? '—' : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`}
          {pausedAt && <span className="timer-paused">paused</span>}
        </div>
      </div>
      <div className="card" aria-live="polite">
        <Transcript session={session} />
        {partial && (
          <p className="partial-turn"><strong>{customer.label.replace(/^./, (c) => c.toUpperCase())}:</strong> {partial}<span className="typing-dots" aria-hidden="true"> …</span></p>
        )}
        {!partial && busy && session.turns.at(-1)?.speaker === 'rep' && (
          <p className="partial-turn muted" role="status">The {customer.label} is thinking<span className="typing-dots" aria-hidden="true">…</span></p>
        )}
      </div>
      {tapToPlay && (
        <div className="alert info"><button className="btn primary" onClick={() => { if (clips.current.length) { setTapToPlay(null); playNextClip(); } else { void audioEl.current?.play().then(() => setTapToPlay(null)).catch(() => {}); setMic('resident_speaking'); } }}>Tap to hear the {customer.label}</button></div>
      )}
      {notice && <div className="alert warn" role="status">{notice}</div>}
      {error && <ErrorBox message={error} />}
      <div className="composer">
        {sttEnabled && (
          <div className="field">
            {mic === 'not_requested' || mic === 'failed' ? (
              <button className="btn primary mic-btn" onClick={enableMic} disabled={busy}>Enable microphone</button>
            ) : mic === 'permission_denied' || mic === 'unsupported' || mic === 'requesting' ? null : (
              <button className={`btn primary mic-btn ${mic === 'recording' ? 'recording' : ''}`} onClick={toggleRecord}
                disabled={busy || (mic !== 'ready' && mic !== 'recording')} aria-pressed={mic === 'recording'}>
                {mic === 'recording' ? (handsFree ? 'Send now' : 'Stop and send') : 'Tap to speak'}
              </button>
            )}
            {mic === 'resident_speaking' && <button type="button" className="btn" onClick={skipCustomer}>Skip to my reply</button>}
            <p className="hint" role="status" aria-live="polite">{mic === 'recording' && handsFree ? HANDS_FREE_RECORDING_TEXT : MIC_STATE_TEXT[mic]}</p>
            {mic !== 'permission_denied' && mic !== 'unsupported' && (
              <label className="check small"><input type="checkbox" checked={handsFree} onChange={(e) => setHandsFree(e.target.checked)} /><span>Hands-free: listen after the {customer.label} speaks, and send when I stop talking</span></label>
            )}
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); void sendTyped(); }}>
          <label htmlFor="typed">{sttEnabled ? 'Or type your reply' : 'Your reply'}</label>
          <textarea id="typed" value={text} maxLength={LIMITS.typedTurnMaxChars} onChange={(e) => setText(e.target.value)} disabled={busy || mic === 'recording'}
            placeholder="Type what you would say…" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendTyped(); } }} />
          <div className="spread" style={{ marginTop: '0.5rem' }}>
            <button type="button" className="btn danger" onClick={end} disabled={busy && !ending.current}>End practice</button>
            <button type="submit" className="btn primary" disabled={busy || !text.trim() || mic === 'recording'}>{busy ? 'Sending…' : 'Send reply'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
