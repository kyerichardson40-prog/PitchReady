'use client';
import { CHANNEL_INFO } from '../../../lib/domain/sales.ts';
import { useEffect, useState } from 'react';
import { getDrill } from '../../../lib/content/scenarios.ts';
import type { FeedbackReport, PracticeSession } from '../../../lib/domain/types.ts';
import { computeProgress, sessionScore } from '../../../lib/domain/progress.ts';
import { DEMO_RUBRIC } from '../../../lib/content/rubric.ts';
import { auth } from '../repo/api-repo.ts';
import { useApp, useAsync } from '../app-context.tsx';
import { Link, useNavigate } from '../router.tsx';
import { Empty, ErrorBox, FictionalTag, Loading, StatusTag, fmtDate, fmtMinutes, sessionTitle } from '../components/ui.tsx';
import { FeedbackView } from '../components/FeedbackView.tsx';
import { Transcript } from '../components/Transcript.tsx';

export { HomePage } from './landing.tsx';

export function PracticePage() {
  const { repo, ctx, ctxError, refresh } = useApp();
  const history = useAsync(() => repo.listMySessions(), [repo, ctx?.user?.id]);
  if (ctxError) return <ErrorBox message={ctxError} onRetry={refresh} />;
  if (!ctx) return <Loading />;
  if (repo.mode === 'connected' && ctx.user && ctx.hasTeam === false) {
    return (
      <div className="stack narrow">
        <h1>You’re not in a team yet</h1>
        {ctx.canStartPilot
          ? <div className="card"><h2>Setting up your own team?</h2><p>Start a free pilot: 60 minutes of practice over 14 days for up to 5 reps.</p><Link className="btn primary" to="/start">Start a free pilot</Link></div>
          : <p>New teams are set up by arrangement. <Link to="/contact">Contact us</Link> to get started.</p>}
        <div className="card"><h2>Joining your manager’s team?</h2><p>Open the invitation link they sent you. It only works with the email address it was sent to ({ctx.user.email}).</p></div>
      </div>
    );
  }
  if (ctx.user?.role !== 'rep') return <ErrorBox message="Practice is available in the rep view." />;
  if (!ctx.membershipActive) return <ErrorBox message="Your membership is not active. Ask your manager if you think this is a mistake." />;
  if (!ctx.campaign) return <Empty>Your agency has not published a campaign yet. Ask your manager to publish one.</Empty>;
  const u = ctx.usage;
  const remaining = u ? u.allowanceSeconds - u.consumedSeconds - u.reservedSeconds : null;
  const recent = history.data?.slice(0, 3) ?? [];
  const active = history.data?.find((s) => s.status === 'active' && s.deadlineAt && new Date(s.deadlineAt) > new Date());
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Practise</h1>
        {remaining !== null && <span className="time-pill" aria-label="Team practice time remaining">Team time left <strong>{fmtMinutes(Math.max(0, remaining))}</strong></span>}
      </div>
      <div className="card rules-card">
        <div className="row"><span className="tag teal">{CHANNEL_INFO[ctx.campaign.salesContext.channel].label}</span>{ctx.campaign.fictional && <FictionalTag />}<span className="tag">Version {ctx.campaign.version}</span></div>
        <h2 style={{ marginTop: '0.5rem' }}>{ctx.campaign.name}</h2>
        {ctx.campaign.mustSay.length > 0 && (
          <details><summary>What you must say</summary>
            <ul className="small">{ctx.campaign.mustSay.map((m) => <li key={m.id}>{m.text}</li>)}</ul>
          </details>
        )}
        {(ctx.campaign.neverSay.length > 0 || ctx.campaign.forbiddenClaims.length > 0) && (
          <details><summary>What you must never say</summary>
            <ul className="small">
              {ctx.campaign.neverSay.map((p) => <li key={p}>“{p}”</li>)}
              {ctx.campaign.forbiddenClaims.map((p) => <li key={p}>{p}</li>)}
            </ul>
          </details>
        )}
        <details><summary>Approved facts you can use</summary>
          <ul className="small">{ctx.campaign.facts.map((f) => <li key={f.id}><strong>{f.id}</strong> {f.text}</li>)}</ul>
        </details>
        {ctx.campaign.objectionAnswers.length > 0 && (
          <details><summary>Approved answers to common objections</summary>
            <dl className="small">{ctx.campaign.objectionAnswers.map((o) => <div key={o.objection} className="qa"><dt>“{o.objection}”</dt><dd>{o.answer}</dd></div>)}</dl>
          </details>
        )}
      </div>
      {active && <div className="alert warn">You have a practice in progress. <Link to={`/sessions/${active.id}`}>Open it</Link> or let it time out.</div>}
      {remaining !== null && remaining < (ctx.campaign?.practiceMinutes ?? 3) * 60 && <div className="alert warn">Not enough team allowance left to start a full {ctx.campaign?.practiceMinutes ?? 3}-minute session. Speak to your manager.</div>}
      {history.data && <ProgressCard sessions={history.data} />}
      <h2>Choose a scenario</h2>
      <ul className="door-list">
        {ctx.scenarios.map((s, i) => (
          <li key={s.key}>
            <Link to={`/practice/${s.key}`} className={`door-card paint-${i % 4}`}>
              <span className="door-ico" aria-hidden="true"><span className="door-ico-light" /><span className="door-ico-leaf"><span className="door-ico-plate">{i + 1}</span></span></span>
              <span className="door-card-body">
                <strong className="door-card-title">{s.title}</strong>
                <span className="door-card-quote">“{s.opener}”</span>
                <span className="door-card-skill">Practises: {s.skill}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <h2>Previous practice</h2>
      {history.loading ? <Loading /> : history.error ? <ErrorBox message={history.error} onRetry={history.reload} /> : recent.length === 0 ? <Empty>No practice yet. Start with any scenario above.</Empty> : (
        <ul className="scenario-list">
          {recent.map((s) => (
            <li key={s.id}><Link to={`/sessions/${s.id}`} className="scenario-card"><div className="spread"><strong>{sessionTitle(s)}</strong><StatusTag s={s} /></div><span className="small muted">{fmtDate(s.startedAt)}</span></Link></li>
          ))}
        </ul>
      )}
      {(history.data?.length ?? 0) > 3 && <Link to="/history">See all history</Link>}
    </div>
  );
}

export function SessionPage({ id }: { id: string }) {
  const navigate = useNavigate();
  const { repo, ctx, refresh } = useApp();
  const q = useAsync(() => repo.getSession(id), [repo, id, ctx?.user?.id]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Standalone demo with live AI: feedback is written in the background, so check for it.
  const running = repo.mode === 'demo' && q.data?.session.evaluationStatus === 'running';
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => q.reload(), 1500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);
  if (q.loading && !q.data) return <Loading label="Loading feedback…" />;
  if (q.error) return <ErrorBox message={q.error} onRetry={q.reload} />;
  const { session, reports } = q.data!;
  if (session.status === 'active') {
    return (
      <div className="stack">
        <h1>{sessionTitle(session)}</h1>
        <div className="alert warn">This practice is still in progress on the server clock.{session.deadlineAt ? ` It ends by ${fmtDate(session.deadlineAt)}.` : ''}</div>
        <button className="btn danger" onClick={async () => { await repo.endSession(session.id, { idempotencyKey: `end-${session.id}` }); await refresh(); q.reload(); }}>End it now</button>
        <Transcript session={session} />
      </div>
    );
  }
  const latest = session.evaluations.at(-1);
  const retry = latest?.status === 'completed' ? latest.result?.retry : null;
  const runEval = async () => {
    setBusy(true); setErr(null);
    try { await repo.retryEvaluation(session.id); q.reload(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="stack">
      <div className="spread"><h1 style={{ margin: 0 }}>{sessionTitle(session)}</h1><StatusTag s={session} /></div>
      <p className="small muted">{fmtDate(session.startedAt)} · {session.campaignName} v{session.campaignVersion} · ended: {session.endReason?.replace(/_/g, ' ') ?? '—'}{session.usedSeconds !== null ? ` · ${session.usedSeconds}s used` : ''}</p>
      {err && <ErrorBox message={err} />}
      {running && (
        <div className="card" role="status">
          <h2>Claude is writing your feedback…</h2>
          <p>This usually takes under a minute. Your transcript is saved.</p>
        </div>
      )}
      {!running && (session.evaluationStatus === 'pending' || session.evaluationStatus === 'running') && (
        <div className="card">
          <h2>Feedback pending</h2>
          <p>Your transcript is saved. Feedback hasn’t been produced yet.</p>
          {repo.liveAi?.lastError && <p className="small muted">{repo.liveAi.lastError}</p>}
          <button className="btn primary" onClick={runEval} disabled={busy}>{busy ? 'Working…' : repo.mode !== 'demo' ? 'Check again' : ctx?.liveAi ? 'Run AI feedback now' : 'Run demo feedback now'}</button>
        </div>
      )}
      {session.evaluationStatus === 'unavailable' && (
        <div className="card">
          <h2>Feedback unavailable</h2>
          <p>We couldn’t produce valid feedback for this practice. Your transcript is saved, and nothing invalid has been shown. You can try again.</p>
          <button className="btn primary" onClick={runEval} disabled={busy}>Try feedback again</button>
        </div>
      )}
      {session.evaluationStatus === 'completed' && <FeedbackView session={session} audience="rep" mustSay={ctx?.campaign?.mustSay} />}
      {retry && (
        <div className="card" style={{ borderColor: 'var(--teal)' }}>
          <h2>Retry the weakest part</h2>
          <p>{retry.objective}</p>
          <button className="btn primary big" onClick={() => navigate(`/practice/${retry.scenario_key}?drill=${retry.drill_key ?? ''}&parent=${session.id}`)}>
            Start {retry.max_seconds}-second drill{retry.drill_key ? `: ${getDrill(retry.drill_key)?.title}` : ''}
          </button>
        </div>
      )}
      {session.evaluationStatus !== 'completed' && <div className="card"><h2>Transcript</h2><Transcript session={session} /></div>}
      {ctx?.user?.id === session.repId && <ReportForm sessionId={session.id} reports={reports} onDone={q.reload} />}
    </div>
  );
}

function ReportForm({ sessionId, reports, onDone }: { sessionId: string; reports: FeedbackReport[]; onDone: () => void }) {
  const { repo } = useApp();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<FeedbackReport['reason']>('transcription_error');
  const [desc, setDesc] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="card">
      <h2>Something wrong?</h2>
      {reports.length > 0 && <p className="small">You’ve reported {reports.length} issue{reports.length > 1 ? 's' : ''} on this session ({reports.filter((r) => r.status === 'open').length} open).</p>}
      {msg && <div className="alert info" role="status">{msg}</div>}
      {!open ? <button className="btn" onClick={() => setOpen(true)}>Report a transcription or feedback error</button> : (
        <form onSubmit={async (e) => {
          e.preventDefault(); setErr(null);
          try { await repo.reportFeedback(sessionId, { reason, description: desc }); setMsg('Thanks — your manager can see this report.'); setOpen(false); setDesc(''); onDone(); }
          catch (e: any) { setErr(e.message); }
        }}>
          <div className="field"><label htmlFor="reason">What’s wrong?</label>
            <select id="reason" value={reason} onChange={(e) => setReason(e.target.value as FeedbackReport['reason'])}>
              <option value="transcription_error">The transcript doesn’t match what I said</option>
              <option value="feedback_incorrect">The feedback is wrong</option>
              <option value="other">Something else</option>
            </select></div>
          <div className="field"><label htmlFor="desc">Details</label><textarea id="desc" value={desc} onChange={(e) => setDesc(e.target.value)} required minLength={3} maxLength={1000} /></div>
          {err && <ErrorBox message={err} />}
          <div className="row"><button className="btn primary" type="submit">Send report</button><button className="btn" type="button" onClick={() => setOpen(false)}>Cancel</button></div>
        </form>
      )}
    </div>
  );
}

export function HistoryPage() {
  const { repo, ctx } = useApp();
  const q = useAsync(() => repo.listMySessions(), [repo, ctx?.user?.id]);
  return (
    <div className="stack">
      <h1>Your practice history</h1>
      {q.data && <ProgressCard sessions={q.data} />}
      {q.loading ? <Loading /> : q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : !q.data?.length ? <Empty>No sessions yet.</Empty> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Practice</th><th>Score</th><th>Campaign / rubric</th><th>Status</th></tr></thead>
            <tbody>{q.data.map((s) => (
              <tr key={s.id}>
                <td>{fmtDate(s.startedAt)}</td>
                <td><Link to={`/sessions/${s.id}`}>{sessionTitle(s)}</Link></td>
                <td>{sessionScore(s)?.toFixed(1) ?? <span className="muted">–</span>}</td>
                <td className="small">v{s.campaignVersion} · {s.rubricVersion}</td>
                <td><StatusTag s={s} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function SettingsPage() {
  const { repo, ctx, refresh } = useApp();
  const [msg, setMsg] = useState<string | null>(null);
  const [scope, setScope] = useState<'my_transcripts' | 'my_account'>('my_transcripts');
  if (!ctx?.user) return <Loading />;
  return (
    <div className="stack">
      <h1>Settings</h1>
      <div className="card">
        <h2>Profile</h2>
        <p className="muted">{ctx.user.email}</p>
        <NameForm />
        {ctx.agencyName && <p className="small">Role: {ctx.user.role} at {ctx.agencyName}{ctx.membershipActive ? '' : ' (inactive)'}</p>}
      </div>
      {repo.mode === 'connected' && <PasswordForm />}
      <div className="card">
        <h2>Who can see your practice</h2>
        <ul className="small">
          <li>Managers at {ctx.agencyName} can read your saved practice transcripts, feedback and any error reports you send.</li>
          <li>Other reps cannot see your transcripts.</li>
          <li>Voice recordings are not kept. When you speak, the recording is sent to our speech provider to be turned into text, and the provider is told not to keep it or use it to train its models.</li>
          <li>Transcripts and feedback are deleted after {ctx.retentionDays ?? 30} days (your team’s setting). Totals of practice time may be kept for billing.</li>
          <li>Feedback is coaching, not a compliance certificate or an employment decision.</li>
        </ul>
      </div>
      <div className="card">
        <h2>Request deletion</h2>
        {msg && <div className="alert info" role="status">{msg}</div>}
        <form onSubmit={async (e) => { e.preventDefault(); await repo.requestDeletion({ scope }); setMsg('Request recorded. It is carried out automatically, usually within a few minutes.'); }}>
          <div className="field"><label htmlFor="scope">What should be deleted?</label>
            <select id="scope" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
              <option value="my_transcripts">My practice transcripts and feedback</option>
              <option value="my_account">My account and practice data</option>
            </select></div>
          <button className="btn" type="submit">Submit deletion request</button>
        </form>
      </div>
      {repo.mode === 'demo' && (
        <div className="card">
          <h2>Demo data</h2>
          <p className="small">Everything here is fictional and stored in this browser only.</p>
          <button className="btn danger" onClick={async () => { await repo.demoReset!(); await refresh(); setMsg('Demo data reset to the fictional seed.'); }}>Reset demo data</button>
        </div>
      )}
    </div>
  );
}

const SKILL_LABEL: Record<string, string> = Object.fromEntries(DEMO_RUBRIC.dimensions.map((d) => [d.key, d.label]));

/** The rep's own progress: recent average and trend, streak, best session and skills. */
export function ProgressCard({ sessions }: { sessions: PracticeSession[] }) {
  const p = computeProgress(sessions, new Date(), sessionTitle);
  if (p.scored === 0) return null;
  const change = p.average !== null && p.previousAverage !== null ? Math.round((p.average - p.previousAverage) * 10) / 10 : null;
  const W = 14, H = 44;
  return (
    <section className="card progress-card" aria-labelledby="progress-title">
      <h2 id="progress-title">Your progress</h2>
      <div className="progress-stats">
        <div className="progress-stat"><span className="progress-num">{p.average?.toFixed(1)}<small> / 5</small></span><span className="small muted">Average, last {Math.min(5, p.scored)} session{p.scored === 1 ? '' : 's'}</span>
          {change !== null && <span className={`tag ${change > 0 ? 'teal' : ''}`}>{change > 0 ? `Up ${change.toFixed(1)}` : change < 0 ? `Down ${Math.abs(change).toFixed(1)}` : 'Level'} on the 5 before</span>}</div>
        <div className="progress-stat"><span className="progress-num">{p.streakDays}<small> day{p.streakDays === 1 ? '' : 's'}</small></span><span className="small muted">{p.streakDays === 0 ? 'Practise today to start a streak' : p.practisedToday ? 'Streak: practised today' : 'Streak: practise today to keep it'}</span></div>
        {p.best && <div className="progress-stat"><span className="progress-num">{p.best.score.toFixed(1)}<small> best</small></span><Link className="small" to={`/sessions/${p.best.id}`}>{p.best.title}</Link></div>}
      </div>
      {p.recent.length >= 2 && (
        <figure className="progress-chart">
          <svg viewBox={`0 0 ${p.recent.length * W} ${H}`} width={p.recent.length * W * 1.6} height={H * 1.6} role="img" aria-label={`Scores for your last ${p.recent.length} sessions, oldest first: ${p.recent.map((r) => r.score.toFixed(1)).join(', ')}`}>
            {p.recent.map((r, i) => { const h = Math.max(3, (r.score / 5) * (H - 2)); return <rect key={r.id} x={i * W + 2} y={H - h} width={W - 4} height={h} rx="2" className={i === p.recent.length - 1 ? 'progress-bar latest' : 'progress-bar'} />; })}
          </svg>
          <figcaption className="small muted">Last {p.recent.length} scored sessions, oldest to newest</figcaption>
        </figure>
      )}
      <dl className="progress-skills">
        {p.skills.filter((k) => k.average !== null).map((k) => (
          <div key={k.key} className="progress-skill">
            <dt>{SKILL_LABEL[k.key] ?? k.key}</dt>
            <dd><strong>{k.average!.toFixed(1)}</strong>{k.previous !== null && k.average !== k.previous && <span className="small muted"> ({k.average! > k.previous ? 'up' : 'down'} from {k.previous.toFixed(1)})</span>}
              <span className="bar" aria-hidden="true"><svg viewBox="0 0 100 10" preserveAspectRatio="none" width="100%" height="10"><rect width={k.average! * 20} height="10" className="progress-bar" /></svg></span></dd>
          </div>
        ))}
      </dl>
      <p className="small muted m0">Based on the sessions still kept for you; older ones are deleted. Scores are coaching, not a grade.</p>
    </section>
  );
}

function NameForm() {
  const { repo, ctx, refresh } = useApp();
  const [name, setName] = useState(ctx?.user?.name ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form onSubmit={async (e) => { e.preventDefault(); setMsg(null); setErr(null); try { await repo.updateName(name.trim()); await refresh(); setMsg('Name saved.'); } catch (e: any) { setErr(e.message); } }}>
      {err && <ErrorBox message={err} />}
      <div className="field"><label htmlFor="set-name">Your name</label><input id="set-name" required maxLength={80} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        <p className="hint">Shown to your manager and on your practice history.</p></div>
      <div className="row"><button className="btn" type="submit" disabled={!name.trim() || name.trim() === ctx?.user?.name}>Save name</button>{msg && <span className="small" role="status">{msg}</span>}</div>
    </form>
  );
}

function PasswordForm() {
  const [recovery, setRecovery] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fromLink = typeof location !== 'undefined' && new URLSearchParams(location.search).has('reset');
  useEffect(() => { auth.passwordStatus().then((r) => setRecovery(r.recovery)).catch(() => {}); }, []);
  return (
    <div className="card" id="password">
      <h2>{recovery && fromLink ? 'Choose a new password' : 'Change password'}</h2>
      {recovery && fromLink && <div className="alert info">You came from a password-reset link. Choose a new password below.</div>}
      {err && <ErrorBox message={err} />}
      {msg && <div className="alert info" role="status">{msg}</div>}
      <form onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr(null); setMsg(null);
        try { await auth.changePassword(next, recovery ? undefined : current); setCurrent(''); setNext(''); setRecovery(false); setMsg('Password changed.'); }
        catch (e: any) { setErr(e.message); } finally { setBusy(false); }
      }}>
        {!recovery && <div className="field"><label htmlFor="pw-cur">Current password</label><input id="pw-cur" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} /></div>}
        <div className="field"><label htmlFor="pw-new">New password</label><input id="pw-new" type="password" autoComplete="new-password" required minLength={10} value={next} onChange={(e) => setNext(e.target.value)} /><p className="hint">At least 10 characters.</p></div>
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
      </form>
    </div>
  );
}

export function NotFoundPage() {
  return <ErrorBox message="Page not found." />;
}
