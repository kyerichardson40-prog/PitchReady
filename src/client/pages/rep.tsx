'use client';
import { CHANNEL_INFO } from '../../../lib/domain/sales.ts';
import { useEffect, useState } from 'react';
import { getDrill } from '../../../lib/content/scenarios.ts';
import type { FeedbackReport } from '../../../lib/domain/types.ts';
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
      {remaining !== null && remaining < 180 && <div className="alert warn">Not enough team allowance left to start a full three-minute session. Speak to your manager.</div>}
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
      {q.loading ? <Loading /> : q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : !q.data?.length ? <Empty>No sessions yet.</Empty> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Practice</th><th>Campaign / rubric</th><th>Status</th></tr></thead>
            <tbody>{q.data.map((s) => (
              <tr key={s.id}>
                <td>{fmtDate(s.startedAt)}</td>
                <td><Link to={`/sessions/${s.id}`}>{sessionTitle(s)}</Link></td>
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
        <p><strong>{ctx.user.name}</strong><br /><span className="muted">{ctx.user.email}</span></p>
        <p className="small">Role: {ctx.user.role} at {ctx.agencyName}{ctx.membershipActive ? '' : ' (inactive)'}</p>
      </div>
      <div className="card">
        <h2>Who can see your practice</h2>
        <ul className="small">
          <li>Managers at {ctx.agencyName} can read your saved practice transcripts, feedback and any error reports you send.</li>
          <li>Other reps cannot see your transcripts.</li>
          <li>Raw audio is not kept by this app by default. When voice is enabled, audio is sent to a speech provider to transcribe; the provider’s own data handling is configured and verified separately.</li>
          <li>Transcripts and feedback are deleted after {ctx.retentionDays ?? 30} days (agency setting). Aggregate usage counts may be kept for billing.</li>
          <li>Feedback is coaching, not a compliance certificate or an employment decision.</li>
        </ul>
      </div>
      <div className="card">
        <h2>Request deletion</h2>
        {msg && <div className="alert info" role="status">{msg}</div>}
        <form onSubmit={async (e) => { e.preventDefault(); await repo.requestDeletion({ scope }); setMsg('Request recorded. Your agency will action it; you’ll keep access until then.'); }}>
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

export function NotFoundPage() {
  return <ErrorBox message="Page not found." />;
}
