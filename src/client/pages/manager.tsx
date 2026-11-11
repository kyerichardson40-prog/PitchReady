'use client';
import { CHANNEL_INFO, SALES_CHANNELS, salesContextOf, type SalesChannel, type SalesContext } from '../../../lib/domain/sales.ts';
import { SALES_TEMPLATES, getTemplate, type SalesTemplate } from '../../../lib/content/templates.ts';
import { useEffect, useState } from 'react';
import { DEMO_RUBRIC } from '../../../lib/content/rubric.ts';
import { PRACTICE_MINUTES, practiceMinutesOf, type PracticeMinutes } from '../../../lib/domain/limits.ts';
import { MIN_SAMPLE, type WeekTrend } from '../../../lib/domain/metrics.ts';
import { onboardingApi } from '../repo/api-repo.ts';
import { AnswerCounts, AnswerQuotes } from '../components/Answers.tsx';
import { campaignPackSchema, rubricDimensionsSchema } from '../../../lib/domain/schemas.ts';
import type { CampaignPack, ManagerReview, RubricVersion } from '../../../lib/domain/types.ts';
import { newKey, useApp, useAsync } from '../app-context.tsx';
import { Link } from '../router.tsx';
import { ErrorBox, FictionalTag, Loading, StatusTag, fmtDate, fmtMinutes, sessionTitle } from '../components/ui.tsx';
import { FeedbackView } from '../components/FeedbackView.tsx';
import { useManagerGuard } from './manager-guard.tsx';
import { RepDirectory } from './manager-team.tsx';
import { Transcript } from '../components/Transcript.tsx';
import { collectTeamExport, downloadFile, exportFileName, teamExportCsv } from '../team-export.ts';


const SAMPLE_LABELS = { sample_opening: 'Opening line', sample_explanation: 'Explaining the campaign', sample_unknown_answer: "When you don't know the answer", sample_disengagement: 'Leaving politely' } as const;

export function ManagerOverviewPage() {
  const guard = useManagerGuard();
  const { repo, ctx } = useApp();
  const [days, setDays] = useState(14);
  const ov = useAsync(() => (ctx?.user?.role === 'manager' ? repo.getOverview(days) : Promise.resolve(null)), [repo, days, ctx?.user?.id]);
  const sessions = useAsync(() => (ctx?.user?.role === 'manager' ? repo.listTeamSessions() : Promise.resolve([])), [repo, ctx?.user?.id]);
  if (guard) return guard;
  const o = ov.data;
  const flagged = (sessions.data ?? []).filter((s) => s.openConcerns + s.openReports > 0);
  const label = (k: string) => DEMO_RUBRIC.dimensions.find((d) => d.key === k)?.label ?? k;
  return (
    <div className="stack">
      <div className="spread">
        <h1 style={{ margin: 0 }}>Team overview</h1>
        <div><label htmlFor="period" className="visually-hidden">Period</label>
          <select id="period" value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 'auto' }}>
            <option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option>
          </select></div>
      </div>
      {ov.loading && !o ? <Loading /> : ov.error ? <ErrorBox message={ov.error} onRetry={ov.reload} /> : o && (
        <>
          <div className="grid three">
            <div className="card stat-tile tile-teal"><div className="metric">{o.repsWithCompleted} of {o.activeReps}</div><div className="small muted">active reps with a completed session in the last {o.periodDays} days</div></div>
            <div className="card stat-tile tile-mustard"><div className="metric">{o.completedSessions}</div><div className="small muted">sessions with completed feedback · {o.minutesUsed} min used</div></div>
            <div className={`card stat-tile ${o.openFlags > 0 ? 'tile-red' : 'tile-plain'}`}><div className="metric">{o.openFlags}</div><div className="small muted">open review flags (concerns + rep reports)</div></div>
          </div>
          <div className="card">
            <div className="spread"><h2 style={{ margin: 0 }}>Practice allowance</h2><span className="small">{fmtMinutes(Math.max(0, o.remainingSeconds))} of {fmtMinutes(o.allowanceSeconds)} left</span></div>
            <div className="bar" style={{ marginTop: '0.5rem' }} aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, (o.remainingSeconds / o.allowanceSeconds) * 100))}%` }} /></div>
            <p className="small muted" style={{ marginTop: '0.5rem' }}>Practice pauses when the pooled allowance runs out. In-progress sessions hold a reservation until they end.</p>
          </div>
          <TrendCard trend={o.trend ?? []} />
          <TeamAnswersCard />
          <div className="card">
            <h2>Skill breakdown · rubric {o.rubricVersion}</h2>
            <p className="small muted">Means use observed scores only. “Not observed” is never counted as zero. Fewer than {MIN_SAMPLE} observations is shown as not enough data.</p>
            <div className="table-wrap"><table className="rtable">
              <thead><tr><th>Area</th><th>Observed</th><th>Mean</th><th>Scores 1·2·3·4·5</th></tr></thead>
              <tbody>{o.breakdown.map((d) => (
                <tr key={d.key}>
                  <td className="rt-main"><strong>{label(d.key)}</strong></td>
                  <td data-label="Observed">{d.observed} <span className="muted small">({d.notObserved} not observed)</span></td>
                  <td data-label="Mean">{d.enoughData && d.mean !== null ? <span className="mean"><span className="mean-num">{d.mean.toFixed(1)}</span><span className="mean-bar" aria-hidden="true"><span style={{ width: `${(d.mean / 5) * 100}%` }} /></span></span> : <span className="muted small">Not enough data</span>}</td>
                  <td data-label="Scores 1·2·3·4·5" className="small">{[1, 2, 3, 4, 5].map((s) => d.distribution[s as 1]).join(' · ')}</td>
                </tr>
              ))}</tbody>
            </table></div>
            {o.excludedOtherRubric.length > 0 && <p className="small muted">Not combined: {o.excludedOtherRubric.map((x) => `${x.sessions} session(s) on rubric ${x.version}`).join(', ')}.</p>}
          </div>
        </>
      )}
      <div className="card">
        <h2>Flagged for review</h2>
        {sessions.loading ? <Loading /> : flagged.length === 0 ? <p className="muted">Nothing flagged.</p> : (
          <ul className="small flag-list">
            {flagged.map((s) => <li key={s.id}><Link to={`/manager/sessions/${s.id}`}>{s.repName} · {sessionTitle(s)}</Link> — {s.openConcerns} concern(s), {s.openReports} report(s) · {fmtDate(s.endedAt)}</li>)}
          </ul>
        )}
      </div>
      <div className="card">
        <h2>Recent sessions</h2>
        {sessions.loading ? <Loading /> : sessions.error ? <ErrorBox message={sessions.error} /> : !sessions.data?.length ? <p className="muted">No completed practice yet.</p> : (
          <div className="table-wrap"><table className="rtable">
            <thead><tr><th>Practice</th><th>Rep</th><th>Ended</th><th>Status</th></tr></thead>
            <tbody>{sessions.data.slice(0, 25).map((s) => (
              <tr key={s.id}><td className="rt-main"><Link to={`/manager/sessions/${s.id}`}>{sessionTitle(s)}</Link></td><td data-label="Rep">{s.repName}</td><td data-label="Ended" className="small">{fmtDate(s.endedAt)}</td><td data-label="Status"><StatusTag s={s} /></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

export function ManagerRepsPage() {
  const guard = useManagerGuard();
  const { repo, ctx } = useApp();
  const roster = useAsync(() => (ctx?.user?.role === 'manager' ? repo.getRoster() : Promise.resolve(null)), [repo, ctx?.user?.id]);
  const admin = useAsync(() => (ctx?.user?.role === 'manager' ? repo.getScenarioAdmin() : Promise.resolve(null)), [repo, ctx?.user?.id]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'rep' | 'manager'>('rep');
  const [link, setLink] = useState<{ link: string; expiresAt: string; emailed?: boolean; email?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  if (guard) return guard;
  const r = roster.data;
  const act = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); roster.reload(); } catch (e: any) { setErr(e.message); } };
  return (
    <div className="stack">
      <h1>Team</h1>
      <p className="small muted">Your rep database. Open a rep to see their skills and history, choose their scenarios, or remove access.</p>
      {err && <ErrorBox message={err} />}
      {roster.loading ? <Loading /> : roster.error ? <ErrorBox message={roster.error} onRetry={roster.reload} /> : r && (
        <>
          <RepDirectory members={r.members} admin={admin.data ?? null} />
          <p className="small muted">Managers: {r.members.filter((m) => m.role === 'manager').map((m) => m.name).join(', ')} · Seat limit {r.seatLimit} reps.</p>
          <div className="card invite-card">
            <h2>Invite someone</h2>
            <p className="small muted">This creates a single-use link. If we can’t email it to them for you, copy it and send it yourself.</p>
            <form onSubmit={async (e) => { e.preventDefault(); setCopied(false); await act(async () => { const sentTo = email; setLink({ ...(await repo.createInvitation({ email, role })), email: sentTo }); setEmail(''); }); }}>
              <div className="grid two">
                <div className="field"><label htmlFor="inv-email">Email</label><input id="inv-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                <div className="field"><label htmlFor="inv-role">Role</label><select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as 'rep')}><option value="rep">Rep</option><option value="manager">Manager</option></select></div>
              </div>
              <button className="btn primary" type="submit">Create invite link</button>
            </form>
            {link && (
              <div className="alert info" style={{ marginTop: '0.75rem' }}>
                <p role="status"><strong>{link.emailed ? `Invitation emailed to ${link.email}.` : 'Not emailed: copy this link and send it to them yourself.'}</strong></p>
                <p style={{ wordBreak: 'break-all' }}><strong>Invite link</strong> (shown once; expires {fmtDate(link.expiresAt)}):<br /><code>{link.link}</code></p>
                <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(link.link); setCopied(true); } catch { setCopied(false); } }}>{copied ? 'Copied' : 'Copy link'}</button>
              </div>
            )}
          </div>
          <TeamSettings />
          <TeamDataExport />
          <div className="card table-wrap">
            <h2>Invitations</h2>
            {r.invitations.length === 0 ? <p className="muted">No invitations.</p> : (
              <table className="rtable">
                <thead><tr><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
                <tbody>{r.invitations.map((i) => {
                  const status = i.usedAt ? 'Accepted' : i.revokedAt ? 'Revoked' : new Date(i.expiresAt) < new Date() ? 'Expired' : `Pending · expires ${fmtDate(i.expiresAt)}`;
                  return (
                    <tr key={i.id}><td className="rt-main"><strong>{i.email}</strong></td><td data-label="Role">{i.role}</td><td data-label="Status" className="small">{status}</td>
                      <td className="rt-actions">{!i.usedAt && !i.revokedAt && new Date(i.expiresAt) > new Date() && <button className="btn danger" onClick={() => void act(() => repo.revokeInvitation(i.id))}>Revoke</button>}</td></tr>
                  );
                })}</tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** What the team said when they joined: what they find hard and what they want help with. */
function TeamAnswersCard() {
  const { repo } = useApp();
  const q = useAsync(() => (repo.mode === 'connected' ? onboardingApi.team() : Promise.resolve([])), [repo]);
  const reps = (q.data ?? []).filter((a) => a.role === 'rep');
  if (!q.data || reps.length === 0) return null;
  return (
    <div className="card">
      <h2>What your reps told us</h2>
      <p className="small muted">When they joined, {reps.length} rep{reps.length === 1 ? '' : 's'} said what they find hardest and what they want help with. Use it to choose scenarios to assign.</p>
      <div className="owner-grid">
        <AnswerCounts answers={reps} role="rep" kind="struggles" title="Find hardest" />
        <AnswerCounts answers={reps} role="rep" kind="goals" title="Want help with" />
      </div>
      <AnswerQuotes answers={reps} who={(a) => a.name ?? 'Rep'} />
    </div>
  );
}

const WEEK_LABEL = ['Last 7 days', '1 week before', '2 weeks before', '3 weeks before'];

/** Four weeks at a glance: how much the team practised and how scores moved. */
function TrendCard({ trend }: { trend: WeekTrend[] }) {
  if (trend.every((w) => w.sessions === 0)) return null;
  const max = Math.max(1, ...trend.map((w) => w.sessions));
  const latest = trend.at(-1)!, prior = trend.at(-2);
  const delta = latest.mean !== null && prior?.mean != null ? Math.round((latest.mean - prior.mean) * 10) / 10 : null;
  return (
    <div className="card table-wrap">
      <div className="spread"><h2 className="m0">Last 4 weeks</h2>
        {delta !== null && <span className={`tag ${delta > 0 ? 'teal' : ''}`}>Average score {delta > 0 ? `up ${delta.toFixed(1)}` : delta < 0 ? `down ${Math.abs(delta).toFixed(1)}` : 'level'} on the week before</span>}</div>
      <table className="rtable trend-table">
        <thead><tr><th>Week</th><th>Sessions</th><th>Reps practising</th><th>Average score</th></tr></thead>
        <tbody>{trend.map((w) => (
          <tr key={w.weeksAgo}>
            <td className="rt-main"><strong>{WEEK_LABEL[w.weeksAgo]}</strong></td>
            <td data-label="Sessions"><span className="trend-cell"><span>{w.sessions}</span><svg className="trend-bar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect width={(w.sessions / max) * 100} height="8" rx="2" /></svg></span></td>
            <td data-label="Reps practising">{w.reps}</td>
            <td data-label="Average score">{w.mean === null ? <span className="muted small">{w.sessions === 0 ? '–' : `needs ${MIN_SAMPLE}+ sessions`}</span> : `${w.mean.toFixed(1)} / 5`}</td>
          </tr>
        ))}</tbody>
      </table>
      <p className="small muted m0">Sessions with completed feedback from active reps. Older sessions drop out when they pass your retention period.</p>
    </div>
  );
}

/** How long data is kept and whether managers get emails. */
function TeamSettings() {
  const { repo, ctx, refresh } = useApp();
  const [days, setDays] = useState(String(ctx?.retentionDays ?? 30));
  const [emails, setEmails] = useState(ctx?.emailNotifications ?? true);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const n = Number(days);
  const valid = Number.isInteger(n) && n >= 1 && n <= 365;
  const shorter = valid && n < (ctx?.retentionDays ?? 30);
  return (
    <div className="card">
      <h2>Team settings</h2>
      {err && <ErrorBox message={err} />}
      <form onSubmit={async (e) => {
        e.preventDefault(); setMsg(null); setErr(null);
        if (shorter && !confirm(`Keep practice data for ${n} days? Sessions older than that will be deleted for good within a few minutes.`)) return;
        setBusy(true);
        try { await repo.updateTeamSettings({ retentionDays: n, emailNotifications: emails }); await refresh(); setMsg('Settings saved.'); }
        catch (e: any) { setErr(e.message); } finally { setBusy(false); }
      }}>
        <div className="field"><label htmlFor="ts-days">Keep practice sessions for (days)</label>
          <input id="ts-days" type="number" min={1} max={365} inputMode="numeric" required value={days} onChange={(e) => setDays(e.target.value)} />
          <p className="hint">Between 1 and 365. Transcripts, feedback and review notes are deleted automatically after this. Download your team’s data first if you want to keep it.</p></div>
        <label className="check"><input type="checkbox" checked={emails} onChange={(e) => setEmails(e.target.checked)} /><span>Send managers an email when a session is flagged for review, plus a weekly summary of the team’s practice</span></label>
        <div className="row mt-sm"><button className="btn" type="submit" disabled={busy || !valid}>{busy ? 'Saving…' : 'Save settings'}</button>{msg && <span className="small" role="status">{msg}</span>}</div>
      </form>
    </div>
  );
}

/** Lets a manager take a copy of the team's practice data (terms section 13). */
function TeamDataExport() {
  const { repo, ctx } = useApp();
  const [busy, setBusy] = useState<'csv' | 'json' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = async (kind: 'csv' | 'json') => {
    setBusy(kind); setErr(null); setDone(null);
    try {
      const x = await collectTeamExport(repo, { agencyName: ctx?.agencyName ?? null, retentionDays: ctx?.retentionDays ?? null });
      const name = exportFileName(x, kind);
      if (kind === 'csv') downloadFile(name, teamExportCsv(x), 'text/csv;charset=utf-8');
      else downloadFile(name, JSON.stringify(x, null, 2), 'application/json');
      setDone(`Downloaded ${x.sessions.length} practice session${x.sessions.length === 1 ? '' : 's'} as ${name}.`);
    } catch (e: any) { setErr(e.message ?? 'Could not build the download. Please try again.'); }
    finally { setBusy(null); }
  };
  return (
    <div className="card">
      <h2>Download your team’s data</h2>
      <p className="small muted">A copy of every finished practice session we still hold: transcripts (with your corrections), scores, feedback, rep reports and your review notes. Sessions are deleted after {ctx?.retentionDays ?? 30} days, so download before then if you want to keep them.</p>
      {err && <ErrorBox message={err} />}
      {done && <p className="small" role="status">{done}</p>}
      <div className="row">
        <button className="btn primary" disabled={busy !== null} onClick={() => void run('csv')}>{busy === 'csv' ? 'Preparing…' : 'Spreadsheet (CSV)'}</button>
        <button className="btn" disabled={busy !== null} onClick={() => void run('json')}>{busy === 'json' ? 'Preparing…' : 'Full data (JSON)'}</button>
      </div>
    </div>
  );
}

export function ManagerSessionPage({ id }: { id: string }) {
  const guard = useManagerGuard();
  const { repo, ctx } = useApp();
  const q = useAsync(() => (ctx?.user?.role === 'manager' ? repo.getSession(id) : Promise.resolve(null)), [repo, id, ctx?.user?.id]);
  const [note, setNote] = useState('');
  const [resolution, setResolution] = useState<ManagerReview['resolution']>('noted');
  const [reportId, setReportId] = useState<string>('');
  const [turnId, setTurnId] = useState('');
  const [corrected, setCorrected] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (guard) return guard;
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorBox message={q.error} onRetry={q.reload} />;
  if (!q.data) return null;
  const { session, reports, reviews } = q.data;
  const repTurns = session.turns.filter((t) => t.speaker === 'rep');
  return (
    <div className="stack">
      <Link to="/manager">← Overview</Link>
      <div className="spread"><h1 style={{ margin: 0 }}>{session.repName} · {sessionTitle(session)}</h1><StatusTag s={session} /></div>
      <p className="small muted">{fmtDate(session.startedAt)} · campaign v{session.campaignVersion} · rubric {session.rubricVersion} · transcript revision {session.transcriptRevision} · {session.usedSeconds ?? 0}s · ended: {session.endReason?.replace(/_/g, ' ') ?? '—'}</p>
      {err && <ErrorBox message={err} />}{msg && <div className="alert info" role="status">{msg}</div>}
      {session.evaluationStatus === 'completed' ? <FeedbackView session={session} audience="manager" mustSay={ctx?.campaign?.mustSay} /> : (
        <div className="card"><h2>Feedback {session.evaluationStatus}</h2><Transcript session={session} />
          {session.status !== 'active' && <button className="btn" style={{ marginTop: '0.75rem' }} onClick={async () => { try { await repo.retryEvaluation(session.id); q.reload(); } catch (e: any) { setErr(e.message); } }}>Run feedback again</button>}</div>
      )}
      <div className="card">
        <h2>Rep reports ({reports.length})</h2>
        {reports.length === 0 ? <p className="muted">None.</p> : <ul className="small">{reports.map((r) => <li key={r.id}><span className={`tag ${r.status === 'open' ? 'amber' : ''}`}>{r.status}</span> {r.reason.replace(/_/g, ' ')}: {r.description} <span className="muted">· {fmtDate(r.createdAt)}</span></li>)}</ul>}
      </div>
      <div className="card">
        <h2>Review notes</h2>
        <p className="small muted">Append-only. The original feedback is never edited.</p>
        {reviews.length > 0 && <ul className="small">{reviews.map((r) => <li key={r.id}><strong>{r.managerName}</strong> · {r.resolution.replace(/_/g, ' ')} · {fmtDate(r.createdAt)}<br />{r.note}</li>)}</ul>}
        <form onSubmit={async (e) => {
          e.preventDefault(); setErr(null);
          try { await repo.addReview(session.id, { note, resolution, reportId: reportId || null }); setNote(''); setMsg('Review note added.'); q.reload(); } catch (e: any) { setErr(e.message); }
        }}>
          <div className="field"><label htmlFor="note">Note</label><textarea id="note" required value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} /></div>
          <div className="grid two">
            <div className="field"><label htmlFor="res">Status</label><select id="res" value={resolution} onChange={(e) => setResolution(e.target.value as ManagerReview['resolution'])}>
              <option value="noted">Noted</option><option value="coaching_planned">Coaching planned</option><option value="feedback_disputed">Feedback disputed</option><option value="resolved">Resolved (clears flags)</option></select></div>
            <div className="field"><label htmlFor="rep-report">Linked report (optional)</label><select id="rep-report" value={reportId} onChange={(e) => setReportId(e.target.value)}>
              <option value="">None</option>{reports.map((r) => <option key={r.id} value={r.id}>{r.reason.replace(/_/g, ' ')} · {fmtDate(r.createdAt)}</option>)}</select></div>
          </div>
          <button className="btn primary" type="submit">Add review note</button>
        </form>
      </div>
      {session.status !== 'active' && repTurns.length > 0 && (
        <div className="card">
          <h2>Correct a transcription error</h2>
          <p className="small muted">Creates transcript revision {session.transcriptRevision + 1} and new feedback. Original turns and earlier feedback are kept.</p>
          <form onSubmit={async (e) => {
            e.preventDefault(); setErr(null);
            try { await repo.addCorrection(session.id, { turnId, correctedText: corrected, idempotencyKey: newKey('corr') }); setCorrected(''); setTurnId(''); setMsg('Correction saved; feedback re-run on the new revision.'); q.reload(); } catch (e: any) { setErr(e.message); }
          }}>
            <div className="field"><label htmlFor="turn">Turn</label><select id="turn" required value={turnId} onChange={(e) => { setTurnId(e.target.value); setCorrected(session.turns.find((t) => t.id === e.target.value)?.text ?? ''); }}>
              <option value="">Choose a rep turn…</option>{repTurns.map((t) => <option key={t.id} value={t.id}>{t.id}: {t.text.slice(0, 60)}</option>)}</select></div>
            <div className="field"><label htmlFor="corrected">Corrected text</label><textarea id="corrected" required value={corrected} onChange={(e) => setCorrected(e.target.value)} /></div>
            <button className="btn" type="submit" disabled={!turnId}>Save correction</button>
          </form>
        </div>
      )}
    </div>
  );
}

export function ManagerCampaignPage() {
  const guard = useManagerGuard();
  const { repo, ctx, refresh } = useApp();
  const q = useAsync(() => (ctx?.user?.role === 'manager' ? repo.getCampaignAdmin() : Promise.resolve(null)), [repo, ctx?.user?.id]);
  const [pack, setPack] = useState<CampaignPack | null>(null);
  const [rubric, setRubric] = useState<RubricVersion | null>(null);
  const [errs, setErrs] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    if (!q.data) return;
    const src = q.data.draft ?? q.data.published.at(-1)!;
    // Packs saved before the say rules existed have none of these fields.
    const p = structuredClone(src.pack);
    setPack({ ...p, must_say: p.must_say ?? [], never_say: p.never_say ?? [], objection_answers: p.objection_answers ?? [] }); setRubric(structuredClone(src.rubric));
  }, [q.data]);
  if (guard) return guard;
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorBox message={q.error} onRetry={q.reload} />;
  if (!q.data || !pack || !rubric) return null;
  const current = q.data.published.at(-1)!;
  const set = (patch: Partial<CampaignPack>) => setPack({ ...pack, ...patch });
  const validate = () => {
    const a = campaignPackSchema.safeParse(pack);
    const b = rubricDimensionsSchema.safeParse(rubric.dimensions);
    const list = [...(a.success ? [] : a.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)), ...(b.success ? [] : b.error.issues.map((i) => `rubric ${i.path.join('.')}: ${i.message}`))];
    setErrs(list);
    return list.length === 0;
  };
  return (
    <div className="stack">
      <h1>Rules &amp; campaign</h1>
      <p className="small muted">What your reps must and must never say, the facts they can use and your approved answers. Changes take effect for new practice when you publish.</p>
      <p className="small muted">Published version {current.version} · approved by {current.approvedBy} · {fmtDate(current.publishedAt)}. Publishing creates a new frozen version; existing sessions keep the version they used. Structured fields only — no document upload.</p>
      {q.data.draft && <div className="alert warn">You have an unpublished draft (saved {fmtDate(q.data.draft.updatedAt)}).</div>}
      {msg && <div className="alert info" role="status">{msg}</div>}
      {errs.length > 0 && <div className="alert error" role="alert"><strong>Fix before saving:</strong><ul className="small">{errs.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
      <TemplatePicker onLoad={async (t, withScenarios) => {
        setPack({ ...structuredClone(t.pack), campaign_key: pack.campaign_key, version: pack.version } as CampaignPack);
        setErrs([]);
        let added = 0;
        if (withScenarios) {
          try {
            const have = new Set((await repo.getScenarioAdmin()).scenarios.map((x) => x.title.trim().toLowerCase()));
            for (const sc of t.scenarios) if (!have.has(sc.title.trim().toLowerCase())) { await repo.saveScenario({ key: null, ...sc }); added++; }
          } catch (e: any) { setErrs([`Scenarios: ${e.message}`]); }
        }
        setMsg(`Loaded the “${t.label}” template into this page${withScenarios ? ` and added ${added} practice scenario${added === 1 ? '' : 's'}` : ''}. Edit it to match your real offer, then save and publish.`);
        window.scrollTo(0, 0);
      }} />
      <div className="card">
        <div className="row">{pack.fictional && <FictionalTag />}</div>
        <div className="field"><label htmlFor="c-name">Campaign name</label><input id="c-name" value={pack.name} onChange={(e) => set({ name: e.target.value })} /></div>
        <div className="field"><label htmlFor="c-org">Organisation or brand</label><input id="c-org" value={pack.organisation} onChange={(e) => set({ organisation: e.target.value })} /></div>
      </div>

      <SalesSettingEditor value={salesContextOf(pack)} onChange={(sales_context) => set({ sales_context })}
        minutes={practiceMinutesOf(pack)} onMinutes={(practice_minutes) => set({ practice_minutes })} />

      <section className="card rules-section rules-must" aria-labelledby="rules-must">
        <h2 id="rules-must">What reps must say</h2>
        <p className="small muted">Every practice is checked against these, and feedback shows a must-say checklist. Cue words are example wordings (comma-separated): the AI judges the meaning, the scripted demo matches the words.</p>
        {pack.must_say.map((m, i) => (
          <div key={m.id} className="rule-row field">
            <span className="tag" style={{ marginTop: '0.7rem' }}>{m.id}</span>
            <div className="grow stack">
              <textarea aria-label={`Must-say ${m.id}`} className="short" value={m.text} placeholder="e.g. Make clear that giving is voluntary" onChange={(e) => set({ must_say: pack.must_say.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
              <ListInput label={`Cue words for ${m.id}`} separator="," value={m.cues} placeholder="voluntary, no pressure, fine to say no" onChange={(cues) => set({ must_say: pack.must_say.map((x, j) => (j === i ? { ...x, cues } : x)) })} />
            </div>
            <button className="btn danger" aria-label={`Remove must-say ${m.id}`} onClick={() => set({ must_say: pack.must_say.filter((_, j) => j !== i) })}>Remove</button>
          </div>
        ))}
        <button className="btn" onClick={() => {
          const n = Math.max(0, ...pack.must_say.map((m) => Number(m.id.slice(1)))) + 1;
          set({ must_say: [...pack.must_say, { id: `M${n}`, text: '', cues: [] }] });
        }}>Add must-say statement</button>
      </section>

      <section className="card rules-section rules-never" aria-labelledby="rules-never">
        <h2 id="rules-never">What reps must never say</h2>
        <div className="field">
          <label htmlFor="never-say">Never-say words and phrases (one per line)</label>
          <ListInput id="never-say" multiline value={pack.never_say} placeholder="you have to" onChange={(never_say) => set({ never_say })} />
          <span className="small muted">Flagged in feedback when a rep uses them (exact phrase; the AI also catches obvious variants).</span>
        </div>
        <div className="field">
          <label htmlFor="forbidden-claims">Claims reps must not make (one per line)</label>
          <ListInput id="forbidden-claims" multiline value={pack.forbidden_claims} onChange={(forbidden_claims) => set({ forbidden_claims })} />
          <span className="small muted">Flagged as a possible unsupported campaign claim.</span>
        </div>
      </section>

      <section className="card rules-section rules-facts" aria-labelledby="rules-facts">
        <h2 id="rules-facts">Approved facts</h2>
        <p className="small muted">The only campaign facts reps may state. Anything else should be “I’d need to check”.</p>
        {pack.approved_facts.map((f, i) => (
          <div key={i} className="field row" style={{ alignItems: 'flex-start' }}>
            <span className="tag" style={{ marginTop: '0.7rem' }}>{f.id}</span>
            <textarea aria-label={`Fact ${f.id}`} style={{ flex: 1, minHeight: 60 }} value={f.text} onChange={(e) => set({ approved_facts: pack.approved_facts.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
            <button className="btn danger" aria-label={`Remove fact ${f.id}`} onClick={() => set({ approved_facts: pack.approved_facts.filter((_, j) => j !== i) })}>Remove</button>
          </div>
        ))}
        <button className="btn" onClick={() => {
          const n = Math.max(0, ...pack.approved_facts.map((f) => Number(f.id.slice(1)))) + 1;
          set({ approved_facts: [...pack.approved_facts, { id: `F${n}`, text: '' }] });
        }}>Add fact</button>
      </section>

      <section className="card rules-section rules-objections" aria-labelledby="rules-objections">
        <h2 id="rules-objections">Approved answers to objections</h2>
        <p className="small muted">Your approved responses. Reps can read them before practising, and AI feedback bases its advice on them.</p>
        {pack.objection_answers.map((o, i) => (
          <div key={i} className="rule-row field">
            <div className="grow stack">
              <input aria-label={`Objection ${i + 1}`} value={o.objection} placeholder="e.g. I'm happy with what I've got." onChange={(e) => set({ objection_answers: pack.objection_answers.map((x, j) => (j === i ? { ...x, objection: e.target.value } : x)) })} />
              <textarea aria-label={`Approved answer ${i + 1}`} value={o.answer} placeholder="Your approved answer" onChange={(e) => set({ objection_answers: pack.objection_answers.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)) })} />
            </div>
            <button className="btn danger" aria-label={`Remove objection ${i + 1}`} onClick={() => set({ objection_answers: pack.objection_answers.filter((_, j) => j !== i) })}>Remove</button>
          </div>
        ))}
        <button className="btn" onClick={() => set({ objection_answers: [...pack.objection_answers, { objection: '', answer: '' }] })}>Add objection</button>
      </section>

      <div className="card">
        <h2>Sample lines</h2>
        {(['sample_opening', 'sample_explanation', 'sample_unknown_answer', 'sample_disengagement'] as const).map((k) => (
          <div className="field" key={k}><label htmlFor={k}>{SAMPLE_LABELS[k]}</label><textarea id={k} value={pack[k]} onChange={(e) => set({ [k]: e.target.value } as Partial<CampaignPack>)} /></div>
        ))}
      </div>
      <div className="card rules-card">
        <h2>Rubric anchors</h2>
        <p className="small muted">The example rubric is generic — edit it to match your training method. Changing anchors publishes a new rubric version; progress on different versions is never combined.</p>
        {rubric.dimensions.map((d, di) => (
          <details key={d.key}>
            <summary>{d.label}</summary>
            {d.anchors.map((a, ai) => (
              <div className="field" key={a.score}><label htmlFor={`a-${d.key}-${a.score}`}>Score {a.score}</label>
                <input id={`a-${d.key}-${a.score}`} value={a.description} onChange={(e) => setRubric({ ...rubric, dimensions: rubric.dimensions.map((x, j) => (j === di ? { ...x, anchors: x.anchors.map((y, k) => (k === ai ? { ...y, description: e.target.value } : y)) } : x)) })} /></div>
            ))}
          </details>
        ))}
      </div>
      {preview && (
        <div className="card soft">
          <h2>Preview: what reps see</h2>
          <p><strong>{pack.name}</strong></p>
          <ul className="small">{pack.approved_facts.map((f) => <li key={f.id}><strong>{f.id}</strong> {f.text}</li>)}</ul>
        </div>
      )}
      <div className="row action-bar">
        <button className="btn" onClick={() => setPreview((p) => !p)}>{preview ? 'Hide preview' : 'Preview'}</button>
        <button className="btn" onClick={async () => { if (!validate()) return; try { await repo.saveDraft(pack, rubric); setMsg('Draft saved.'); q.reload(); } catch (e: any) { setErrs([e.message]); } }}>Save draft</button>
        <button className="btn primary" disabled={!q.data.draft} onClick={async () => {
          if (!confirm('Publish this draft as a new approved version? New practice will use it immediately.')) return;
          try { const r = await repo.publishDraft(); setMsg(`Published version ${r.version}.`); await refresh(); q.reload(); } catch (e: any) { setErrs([e.message]); }
        }}>Publish draft</button>
      </div>
      {q.data.published.length > 1 && <p className="small muted">Version history: {q.data.published.map((p) => `v${p.version} (${fmtDate(p.publishedAt)})`).join(', ')}</p>}
    </div>
  );
}

/**
 * A list edited as text (one item per line, or comma-separated). Keeps the raw text while typing so
 * new lines and trailing separators aren't swallowed; the parent receives the trimmed, non-empty items.
 */
function ListInput({ value, onChange, multiline, separator = '\n', label, id, placeholder }: { value: string[]; onChange: (v: string[]) => void; multiline?: boolean; separator?: string; label?: string; id?: string; placeholder?: string }) {
  const join = separator === '\n' ? '\n' : `${separator} `;
  const [raw, setRaw] = useState(value.join(join));
  const parse = (t: string) => t.split(separator).map((x) => x.trim()).filter(Boolean);
  // Follow outside changes (e.g. a reload), but never rewrite what the manager is typing.
  useEffect(() => { if (JSON.stringify(parse(raw)) !== JSON.stringify(value)) setRaw(value.join(join)); }, [value.join('\u0000')]); // eslint-disable-line react-hooks/exhaustive-deps
  const props = { id, 'aria-label': label, placeholder, value: raw, onChange: (e: { target: { value: string } }) => { setRaw(e.target.value); onChange(parse(e.target.value)); } };
  return multiline ? <textarea {...props} /> : <input {...props} />;
}

function TemplatePicker({ onLoad }: { onLoad: (t: SalesTemplate, withScenarios: boolean) => Promise<void> }) {
  const [id, setId] = useState(SALES_TEMPLATES[1]!.id);
  const [withScenarios, setWithScenarios] = useState(true);
  const [busy, setBusy] = useState(false);
  const t = getTemplate(id)!;
  return (
    <details className="card template-card">
      <summary>Start from a template</summary>
      <p className="small muted">Ready-made, fictional examples for different kinds of sales. Loading one replaces the fields below (nothing is saved until you choose Save draft).</p>
      <div className="field">
        <label htmlFor="tpl">Kind of sales</label>
        <select id="tpl" value={id} onChange={(e) => setId(e.target.value)}>
          {SALES_TEMPLATES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
        <p className="small muted m0">{t.blurb} Example: {t.pack.organisation}.</p>
      </div>
      <label className="row"><input type="checkbox" checked={withScenarios} onChange={(e) => setWithScenarios(e.target.checked)} /> Also add its five practice scenarios (added straight away; you can edit or archive them)</label>
      <div className="row mt-sm">
        <button className="btn primary" disabled={busy} onClick={async () => {
          if (!confirm(`Replace the fields on this page with the “${t.label}” template?`)) return;
          setBusy(true); try { await onLoad(t, withScenarios); } finally { setBusy(false); }
        }}>{busy ? 'Loading…' : 'Load template'}</button>
      </div>
    </details>
  );
}

const LENGTH_HINT: Record<PracticeMinutes, string> = {
  3: 'Quick openers and objections: doorsteps, the street, short calls. Up to 12 replies.',
  5: 'Room for questions and a proper close: most phone and shop-floor sales. Up to 20 replies.',
  10: 'Full discovery and negotiation: business meetings and longer calls. Up to 40 replies.',
};

function SalesSettingEditor({ value, onChange, minutes, onMinutes }: { value: SalesContext; onChange: (v: SalesContext) => void; minutes: PracticeMinutes; onMinutes: (m: PracticeMinutes) => void }) {
  const set = (patch: Partial<SalesContext>) => onChange({ ...value, ...patch });
  return (
    <section className="card rules-section rules-setting" aria-labelledby="rules-setting">
      <h2 id="rules-setting">Sales setting</h2>
      <p className="small muted">Where your team sells and what. The AI plays the other person to match, and feedback judges good practice for this setting.</p>
      <div className="grid two">
        <div className="field"><label htmlFor="s-channel">Where conversations happen</label>
          <select id="s-channel" value={value.channel} onChange={(e) => set({ channel: e.target.value as SalesChannel })}>
            {SALES_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_INFO[c].label}</option>)}
          </select></div>
        <div className="field"><label htmlFor="s-label">What reps call the other person</label>
          <input id="s-label" value={value.customer_label} placeholder="customer" onChange={(e) => set({ customer_label: e.target.value })} />
          <p className="small muted m0">One plain word, e.g. customer, prospect, resident, client.</p></div>
      </div>
      <div className="field"><label htmlFor="s-offer">What reps offer</label>
        <input id="s-offer" value={value.offer} placeholder="e.g. a full-fibre broadband upgrade" onChange={(e) => set({ offer: e.target.value })} /></div>
      <div className="field"><label htmlFor="s-outcome">What a good outcome looks like</label>
        <input id="s-outcome" value={value.good_outcome} placeholder="e.g. a booked appointment, or a clear no" onChange={(e) => set({ good_outcome: e.target.value })} />
        <p className="small muted m0">Feedback never requires a sale: a respectful “no” can score well.</p></div>
      <div className="field"><label htmlFor="s-length">Practice session length</label>
        <select id="s-length" value={minutes} onChange={(e) => onMinutes(Number(e.target.value) as PracticeMinutes)}>
          {PRACTICE_MINUTES.map((m) => <option key={m} value={m}>{m} minutes</option>)}
        </select>
        <p className="small muted m0">{LENGTH_HINT[minutes]} Longer sessions use more of your practice allowance. Retry drills stay at 60 seconds.</p></div>
    </section>
  );
}
