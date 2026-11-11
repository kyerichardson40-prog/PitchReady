'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { useApp, useAsync } from '../app-context.tsx';
import { Link, useLocation, useNavigate } from '../router.tsx';
import { ownerApi } from '../repo/api-repo.ts';
import { Empty, ErrorBox, Loading, fmtDate } from '../components/ui.tsx';

/* ------------------------------------------------------------------ types (from /api/owner) */
interface Period { id: string; startsAt: string; endsAt: string; allowanceSeconds: number; consumedSeconds: number; reservedSeconds: number; spendMinor: number }
interface TeamRow {
  id: string; name: string; status: 'active' | 'suspended'; createdAt: string; seatLimit: number; retentionDays: number;
  renewAllowanceSeconds: number | null; renewPeriodDays: number; emailNotifications: boolean; isPilot: boolean;
  managers: number; reps: number; inactiveMembers: number; pendingInvites: number; managerEmails: string[];
  period: Period | null; nextPeriod: { startsAt: string; allowanceSeconds: number } | null; sessionsLast30Days: number; lastActivity: string | null;
}
interface Member { userId: string; email: string; name: string | null; role: 'manager' | 'rep'; active: boolean; joinedAt: string; lastSignInAt: string | null; sessions: number }
interface TeamDetail extends TeamRow {
  members: Member[]; invitations: { id: string; email: string; role: string; expiresAt: string }[]; periods: Period[];
  campaign: { name: string; version: number; channel: string | null; practiceMinutes: number | null } | null;
  activity: { at: string; action: string; actor: string }[];
}
interface UserRow { userId: string; email: string; name: string | null; confirmed: boolean; createdAt: string; lastSignInAt: string | null; agencyId: string | null; agencyName: string | null; agencyStatus: string | null; role: 'manager' | 'rep' | null; active: boolean | null; sessions: number }
interface Settings { pilotsEnabled: boolean; pilotSeconds: number; pilotDays: number; pilotDailyCap: number; practicePaused: boolean; practicePausedMessage: string | null; voiceEnabled: boolean; announcement: string | null; announcementTone: 'info' | 'warn'; updatedAt?: string }
interface Overview {
  teams: number; activeTeams: number; pilots: number; pilotsLast7Days: number; users: number; usersLast7Days: number; usersWithoutTeam: number;
  activeReps: number; managers: number; sessionsLast7Days: number; sessionsLast30Days: number; minutesLast30Days: number; aiSpendMinorThisPeriod: number;
  activeSessions: number; newMessages: number; daily: { day: string; sessions: number }[]; settings: Settings;
}
interface Message { id: string; name: string; email: string; company: string | null; teamSize: string | null; salesType: string | null; message: string; status: string; createdAt: string }
interface Activity { at: string; action: string; actor: string; team: string | null; targetType: string | null; metadata: Record<string, unknown> }

const TABS = [['overview', 'Overview'], ['teams', 'Teams'], ['users', 'Users'], ['features', 'Features'], ['messages', 'Messages'], ['activity', 'Activity']] as const;
type Tab = (typeof TABS)[number][0];

const mins = (s: number) => `${Math.round(s / 60).toLocaleString('en-GB')} min`;
const money = (minor: number) => `£${(minor / 100).toFixed(2)}`;
const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const d = (Date.now() - new Date(iso).getTime()) / 86400_000;
  return d < 1 / 24 ? 'just now' : d < 1 ? `${Math.round(d * 24)}h ago` : d < 60 ? `${Math.round(d)}d ago` : fmtDate(iso);
};
const ACTION_LABEL: Record<string, string> = {
  owner_settings_updated: 'Changed site features', owner_team_updated: 'Changed a team', owner_allowance_adjusted: 'Changed practice time',
  owner_team_created: 'Created a team', owner_team_deleted: 'Deleted a team', owner_member_updated: 'Changed a member', owner_member_removed: 'Removed a member',
  owner_message_replied: 'Marked a message replied', owner_message_closed: 'Closed a message', owner_message_spam: 'Marked a message as spam', owner_message_new: 'Reopened a message',
  pilot_started: 'Started a free pilot', allowance_renewed: 'Practice time renewed', agency_bootstrapped: 'Team set up', invitation_created: 'Invited someone',
  invitation_accepted: 'Accepted an invitation', invitation_revoked: 'Cancelled an invitation', campaign_published: 'Published the campaign', agency_settings_updated: 'Changed team settings',
};
const label = (a: string) => ACTION_LABEL[a] ?? a.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** Runs an owner action with a busy state, an error and a confirmation message. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    setBusy(true); setErr(null); setMsg(null);
    try { const r = await fn(); if (ok) setMsg(ok); return r; }
    catch (e: any) { setErr(e?.message ?? 'Something went wrong.'); return undefined; }
    finally { setBusy(false); }
  };
  const feedback = <>{err && <ErrorBox message={err} />}{msg && <p className="alert info" role="status">{msg}</p>}</>;
  return { busy, run, feedback, setMsg };
}

/* ------------------------------------------------------------------ page */
export function OwnerPage() {
  const { repo, ctx } = useApp();
  const { search } = useLocation();
  const navigate = useNavigate();
  const qs = new URLSearchParams(search);
  const tab = (TABS.find(([k]) => k === qs.get('tab'))?.[0] ?? 'overview') as Tab;
  const teamId = qs.get('team');

  if (!ctx) return <Loading />;
  if (repo.mode === 'demo') return <div className="stack narrow"><h1>Owner suite</h1><div className="alert info">The owner suite is part of the live PitchReady site, not the demo.</div></div>;
  if (!ctx.isOwner) return <div className="stack narrow"><h1>Page not found</h1><p><Link to="/">Go to the home page</Link></p></div>;

  const go = (t: Tab, extra: Record<string, string> = {}) => navigate(`/owner?${new URLSearchParams({ tab: t, ...extra })}`);
  return (
    <div className="stack owner">
      <div className="spread"><h1 className="m0">Owner suite</h1><span className="tag">Only you can see this</span></div>
      <nav className="owner-tabs" aria-label="Owner suite">
        {TABS.map(([k, l]) => <Link key={k} to={`/owner?tab=${k}`} current={tab === k}>{l}</Link>)}
      </nav>
      {tab === 'overview' && <OverviewTab go={go} />}
      {tab === 'teams' && (teamId ? <TeamDetailView id={teamId} back={() => go('teams')} /> : <TeamsTab open={(id) => go('teams', { team: id })} />)}
      {tab === 'users' && <UsersTab openTeam={(id) => go('teams', { team: id })} />}
      {tab === 'features' && <FeaturesTab />}
      {tab === 'messages' && <MessagesTab />}
      {tab === 'activity' && <ActivityTab />}
    </div>
  );
}

/* ------------------------------------------------------------------ overview */
function Stat({ n, label: l, paint, onClick }: { n: ReactNode; label: string; paint: string; onClick?: () => void }) {
  const inner = <><span className="owner-stat-n">{n}</span><span className="owner-stat-l">{l}</span></>;
  return onClick ? <button type="button" className={`owner-stat paint-${paint}`} onClick={onClick}>{inner}</button> : <div className={`owner-stat paint-${paint}`}>{inner}</div>;
}

function OverviewTab({ go }: { go: (t: Tab) => void }) {
  const q = useAsync(() => ownerApi.view<Overview>('overview'), []);
  const a = useAction();
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorBox message={q.error} onRetry={q.reload} />;
  const o = q.data!;
  const max = Math.max(1, ...o.daily.map((d) => d.sessions));
  return (
    <>
      {o.settings.practicePaused && <div className="alert warn"><strong>Practice is paused for everyone.</strong> <button className="btn link" onClick={() => go('features')}>Change in Features</button></div>}
      <div className="owner-stats">
        <Stat paint="teal" n={o.activeTeams} label={`active teams (${o.teams} in total)`} onClick={() => go('teams')} />
        <Stat paint="cobalt" n={o.users} label={`accounts · ${o.usersLast7Days} new this week`} onClick={() => go('users')} />
        <Stat paint="mustard" n={o.sessionsLast7Days} label={`practice sessions this week · ${o.sessionsLast30Days} in 30 days`} />
        <Stat paint="red" n={o.newMessages} label="new contact messages" onClick={() => go('messages')} />
      </div>
      <div className="owner-grid">
        <div className="card">
          <h2>Last 14 days</h2>
          <div className="owner-daily" role="img" aria-label={`Practice sessions per day: ${o.daily.map((d) => d.sessions).join(', ')}`}>
            {o.daily.map((d) => <span key={d.day} title={`${fmtDate(d.day)}: ${d.sessions}`} style={{ height: `${Math.max(4, (d.sessions / max) * 100)}%` }} />)}
          </div>
          <p className="small muted m0">Sessions started per day, oldest on the left.</p>
        </div>
        <div className="card">
          <h2>At a glance</h2>
          <dl className="owner-dl">
            <dt>Reps / managers</dt><dd>{o.activeReps} / {o.managers}</dd>
            <dt>Practice minutes (30 days)</dt><dd>{o.minutesLast30Days.toLocaleString('en-GB')}</dd>
            <dt>Free pilots</dt><dd>{o.pilots} ({o.pilotsLast7Days} this week)</dd>
            <dt>Accounts with no team</dt><dd>{o.usersWithoutTeam}</dd>
            <dt>AI cost this period</dt><dd>{money(o.aiSpendMinorThisPeriod)}</dd>
            <dt>Practising right now</dt><dd>{o.activeSessions}</dd>
          </dl>
        </div>
      </div>
      <div className="card">
        <h2>Housekeeping</h2>
        <p className="small muted">Runs automatically every 10 minutes: ends stuck sessions, writes waiting feedback, deletes old data, renews practice time and sends manager emails.</p>
        {a.feedback}
        <button className="btn" disabled={a.busy} onClick={() => void a.run(async () => { await ownerApi.act('runMaintenance'); q.reload(); }, 'Done.')}>{a.busy ? 'Running…' : 'Run it now'}</button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ teams */
function TeamsTab({ open }: { open: (id: string) => void }) {
  const q = useAsync(() => ownerApi.view<TeamRow[]>('teams'), []);
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorBox message={q.error} onRetry={q.reload} />;
  const rows = (q.data ?? []).filter((t) => !filter || `${t.name} ${t.managerEmails.join(' ')}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <>
      <div className="spread">
        <div className="field m0 owner-search"><label htmlFor="team-filter" className="sr-only">Search teams</label><input id="team-filter" type="search" placeholder="Search teams or manager emails" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        <button className="btn primary" onClick={() => setCreating((c) => !c)} aria-expanded={creating}>{creating ? 'Cancel' : 'Create a team'}</button>
      </div>
      {creating && <CreateTeam done={(id) => { setCreating(false); q.reload(); if (id) open(id); }} />}
      {rows.length === 0 ? <Empty>No teams{filter ? ' match that search' : ' yet'}.</Empty> : (
        <div className="card table-wrap">
          <table className="rtable">
            <thead><tr><th>Team</th><th>Manager</th><th>People</th><th>Practice time left</th><th>Renews</th><th>Sessions (30d)</th><th>Last practice</th></tr></thead>
            <tbody>{rows.map((t) => {
              const p = t.period;
              const left = p ? p.allowanceSeconds - p.consumedSeconds - p.reservedSeconds : 0;
              return (
                <tr key={t.id}>
                  <td className="rt-main"><button className="btn link owner-rowlink" onClick={() => open(t.id)}>{t.name}</button>
                    <div className="row owner-tags">{t.status === 'suspended' && <span className="tag red">Suspended</span>}{t.isPilot && <span className="tag">Free pilot</span>}</div></td>
                  <td data-label="Manager" className="small">{t.managerEmails.join(', ') || <span className="muted">{t.pendingInvites ? 'invited' : 'none'}</span>}</td>
                  <td data-label="People">{t.reps} reps · {t.managers} mgr{t.inactiveMembers ? <span className="muted small"> (+{t.inactiveMembers} off)</span> : null}</td>
                  <td data-label="Practice time left">{p ? <>{mins(left)} <span className="muted small">of {mins(p.allowanceSeconds)} · ends {fmtDate(p.endsAt)}</span></> : <span className="tag red">None: can’t practise</span>}</td>
                  <td data-label="Renews" className="small">{t.renewAllowanceSeconds ? `${mins(t.renewAllowanceSeconds)} / ${t.renewPeriodDays}d` : <span className="muted">No</span>}</td>
                  <td data-label="Sessions (30d)">{t.sessionsLast30Days}</td>
                  <td data-label="Last practice" className="small">{ago(t.lastActivity)}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </>
  );
}

function CreateTeam({ done }: { done: (id: string | null) => void }) {
  const tpl = useAsync(() => ownerApi.view<{ templates: { id: string; label: string }[] }>('settings'), []);
  const a = useAction();
  const [f, setF] = useState({ name: '', managerEmail: '', managerName: '', templateId: 'door-fundraising', allowanceMinutes: 150, periodDays: 30, renew: true, seatLimit: 5, retentionDays: 30 });
  const [result, setResult] = useState<{ agencyId: string; managerAdded: boolean; inviteLink: string | null; emailed: boolean } | null>(null);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  if (result) return (
    <div className="card">
      <h2>Team created</h2>
      {result.managerAdded ? <p>{f.managerEmail} already had an account, so they’re now the team’s manager and can sign in straight away.</p> : (
        <>
          <p><strong>{result.emailed ? `Invitation emailed to ${f.managerEmail}.` : `Not emailed: send this link to ${f.managerEmail} yourself.`}</strong> It works once and expires in 14 days.</p>
          <p className="owner-link">{result.inviteLink}</p>
          <button className="btn" onClick={() => void navigator.clipboard?.writeText(result.inviteLink!)}>Copy link</button>
        </>
      )}
      <div className="row mt-sm"><button className="btn primary" onClick={() => done(result.agencyId)}>Open the team</button></div>
    </div>
  );
  return (
    <form className="card" onSubmit={async (e) => {
      e.preventDefault();
      const r = await a.run(() => ownerApi.act<any>('createTeam', { ...f, managerName: f.managerName || undefined }));
      if (r) setResult(r);
    }}>
      <h2>Create a team</h2>
      {a.feedback}
      <div className="owner-form-grid">
        <div className="field"><label htmlFor="ct-name">Team or company name</label><input id="ct-name" required maxLength={120} value={f.name} onChange={(e) => set({ name: e.target.value })} /></div>
        <div className="field"><label htmlFor="ct-email">Manager’s email</label><input id="ct-email" type="email" required value={f.managerEmail} onChange={(e) => set({ managerEmail: e.target.value })} />
          <p className="hint">If they already have an account they become manager now; otherwise they get an invitation.</p></div>
        <div className="field"><label htmlFor="ct-mname">Manager’s name (optional)</label><input id="ct-mname" maxLength={80} value={f.managerName} onChange={(e) => set({ managerName: e.target.value })} /></div>
        <div className="field"><label htmlFor="ct-tpl">Kind of selling (starter content)</label>
          <select id="ct-tpl" value={f.templateId} onChange={(e) => set({ templateId: e.target.value })}>
            {(tpl.data?.templates ?? [{ id: 'door-fundraising', label: 'Door-to-door fundraising' }]).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select><p className="hint">Fictional example campaign and five scenarios they can replace.</p></div>
        <div className="field"><label htmlFor="ct-min">Practice minutes</label><input id="ct-min" type="number" min={1} max={100000} required value={f.allowanceMinutes} onChange={(e) => set({ allowanceMinutes: Number(e.target.value) })} /></div>
        <div className="field"><label htmlFor="ct-days">Period length (days)</label><input id="ct-days" type="number" min={1} max={366} required value={f.periodDays} onChange={(e) => set({ periodDays: Number(e.target.value) })} /></div>
        <div className="field"><label htmlFor="ct-seats">Seats (reps and managers)</label><input id="ct-seats" type="number" min={1} max={500} required value={f.seatLimit} onChange={(e) => set({ seatLimit: Number(e.target.value) })} /></div>
        <div className="field"><label htmlFor="ct-ret">Keep practice data (days)</label><input id="ct-ret" type="number" min={1} max={365} required value={f.retentionDays} onChange={(e) => set({ retentionDays: Number(e.target.value) })} /></div>
      </div>
      <label className="check"><input type="checkbox" checked={f.renew} onChange={(e) => set({ renew: e.target.checked })} /><span>Renew the practice minutes every period (paying customers). Leave unticked for a one-off trial.</span></label>
      <div className="row mt-sm"><button className="btn primary" type="submit" disabled={a.busy}>{a.busy ? 'Creating…' : 'Create team'}</button></div>
    </form>
  );
}

function TeamDetailView({ id, back }: { id: string; back: () => void }) {
  const q = useAsync(() => ownerApi.view<TeamDetail>('team', { id }), [id]);
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <><button className="btn link" onClick={back}>← All teams</button><ErrorBox message={q.error} onRetry={q.reload} /></>;
  const t = q.data!;
  return (
    <>
      <button className="btn link owner-back" onClick={back}>← All teams</button>
      <div className="spread"><h2 className="owner-h2 m0">{t.name}</h2>
        <div className="row owner-tags">{t.status === 'suspended' ? <span className="tag red">Suspended</span> : <span className="tag teal">Active</span>}{t.isPilot && <span className="tag">Free pilot</span>}<span className="small muted">since {fmtDate(t.createdAt)}</span></div></div>
      {t.campaign && <p className="small muted m0">Campaign: {t.campaign.name} (v{t.campaign.version}{t.campaign.channel ? `, ${t.campaign.channel}` : ''}{t.campaign.practiceMinutes ? `, ${t.campaign.practiceMinutes}-minute sessions` : ''})</p>}
      <div className="owner-grid">
        <PracticeTimeCard t={t} reload={q.reload} />
        <TeamSettingsCard t={t} reload={q.reload} />
      </div>
      <MembersCard t={t} reload={q.reload} />
      {t.invitations.length > 0 && (
        <div className="card table-wrap"><h2>Pending invitations</h2>
          <table className="rtable"><thead><tr><th>Email</th><th>Role</th><th>Expires</th></tr></thead>
            <tbody>{t.invitations.map((i) => <tr key={i.id}><td className="rt-main">{i.email}</td><td data-label="Role">{i.role}</td><td data-label="Expires">{fmtDate(i.expiresAt)}</td></tr>)}</tbody></table></div>
      )}
      <div className="owner-grid">
        <div className="card table-wrap"><h2>Practice periods</h2>
          <table className="rtable"><thead><tr><th>Period</th><th>Used</th><th>AI cost</th></tr></thead>
            <tbody>{t.periods.map((p) => <tr key={p.id}><td className="rt-main small">{fmtDate(p.startsAt)} – {fmtDate(p.endsAt)}</td><td data-label="Used">{mins(p.consumedSeconds)} of {mins(p.allowanceSeconds)}</td><td data-label="AI cost">{money(p.spendMinor)}</td></tr>)}</tbody></table></div>
        <div className="card"><h2>Recent activity</h2>
          {t.activity.length === 0 ? <p className="muted small">Nothing yet.</p> : <ul className="owner-log">{t.activity.map((e, i) => <li key={i}><span>{label(e.action)}</span><span className="small muted">{e.actor} · {ago(e.at)}</span></li>)}</ul>}</div>
      </div>
      <DangerCard t={t} back={back} reload={q.reload} />
    </>
  );
}

function PracticeTimeCard({ t, reload }: { t: TeamDetail; reload: () => void }) {
  const a = useAction();
  const [minutes, setMinutes] = useState(60);
  const [days, setDays] = useState(30);
  const p = t.period;
  const left = p ? p.allowanceSeconds - p.consumedSeconds - p.reservedSeconds : 0;
  const change = (sign: 1 | -1) => a.run(async () => { await ownerApi.act('adjustAllowance', { agencyId: t.id, addSeconds: sign * minutes * 60 }); reload(); }, sign > 0 ? `Added ${minutes} minutes.` : `Took away ${minutes} minutes.`);
  return (
    <div className="card">
      <h2>Practice time</h2>
      {p ? <p><strong className="owner-big">{mins(left)}</strong> left of {mins(p.allowanceSeconds)} · ends {fmtDate(p.endsAt)}</p> : <div className="alert warn">No current period: this team can’t practise. Start one below.</div>}
      {t.nextPeriod && <p className="small muted">Next period from {fmtDate(t.nextPeriod.startsAt)}: {mins(t.nextPeriod.allowanceSeconds)}.</p>}
      {a.feedback}
      <div className="row">
        <div className="field m0 owner-num"><label htmlFor="pt-min">Minutes</label><input id="pt-min" type="number" min={1} max={100000} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /></div>
        {p && <button className="btn" disabled={a.busy || minutes < 1} onClick={() => void change(1)}>Add</button>}
        {p && <button className="btn" disabled={a.busy || minutes < 1} onClick={() => void change(-1)}>Take away</button>}
      </div>
      <details className="mt-sm" open={!p}>
        <summary>Start a fresh period now</summary>
        <p className="small muted">Ends the current period and starts a new one with {minutes} minutes{p ? '; minutes left over are not carried across' : ''}.</p>
        <div className="row">
          <div className="field m0 owner-num"><label htmlFor="pt-days">Days</label><input id="pt-days" type="number" min={1} max={366} value={days} onChange={(e) => setDays(Number(e.target.value))} /></div>
          <button className="btn" disabled={a.busy || minutes < 1} onClick={() => void a.run(async () => { await ownerApi.act('adjustAllowance', { agencyId: t.id, addSeconds: minutes * 60, newPeriod: true, days }); reload(); }, 'New period started.')}>Start period</button>
        </div>
      </details>
    </div>
  );
}

function TeamSettingsCard({ t, reload }: { t: TeamDetail; reload: () => void }) {
  const a = useAction();
  const [f, setF] = useState({ name: t.name, seatLimit: t.seatLimit, retentionDays: t.retentionDays, renew: t.renewAllowanceSeconds !== null,
    renewMinutes: Math.round((t.renewAllowanceSeconds ?? 9000) / 60), renewPeriodDays: t.renewPeriodDays, emailNotifications: t.emailNotifications });
  useEffect(() => { setF({ name: t.name, seatLimit: t.seatLimit, retentionDays: t.retentionDays, renew: t.renewAllowanceSeconds !== null, renewMinutes: Math.round((t.renewAllowanceSeconds ?? 9000) / 60), renewPeriodDays: t.renewPeriodDays, emailNotifications: t.emailNotifications }); }, [t]);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); void a.run(async () => {
      await ownerApi.act('updateTeam', { agencyId: t.id, name: f.name.trim(), seatLimit: f.seatLimit, retentionDays: f.retentionDays,
        renewAllowanceSeconds: f.renew ? f.renewMinutes * 60 : null, renewPeriodDays: f.renewPeriodDays, emailNotifications: f.emailNotifications });
      reload();
    }, 'Team saved.'); }}>
      <h2>Plan and settings</h2>
      {a.feedback}
      <div className="field"><label htmlFor="ts-name">Name</label><input id="ts-name" required maxLength={120} value={f.name} onChange={(e) => set({ name: e.target.value })} /></div>
      <div className="owner-form-grid">
        <div className="field"><label htmlFor="ts-seats">Seats</label><input id="ts-seats" type="number" min={1} max={500} value={f.seatLimit} onChange={(e) => set({ seatLimit: Number(e.target.value) })} /></div>
        <div className="field"><label htmlFor="ts-ret">Keep data (days)</label><input id="ts-ret" type="number" min={1} max={365} value={f.retentionDays} onChange={(e) => set({ retentionDays: Number(e.target.value) })} /></div>
      </div>
      <label className="check"><input type="checkbox" checked={f.renew} onChange={(e) => set({ renew: e.target.checked })} /><span>Renew practice time automatically</span></label>
      {f.renew && <div className="owner-form-grid">
        <div className="field"><label htmlFor="ts-rmin">Minutes each period</label><input id="ts-rmin" type="number" min={1} max={100000} value={f.renewMinutes} onChange={(e) => set({ renewMinutes: Number(e.target.value) })} /></div>
        <div className="field"><label htmlFor="ts-rdays">Every (days)</label><input id="ts-rdays" type="number" min={1} max={366} value={f.renewPeriodDays} onChange={(e) => set({ renewPeriodDays: Number(e.target.value) })} /></div>
      </div>}
      <label className="check"><input type="checkbox" checked={f.emailNotifications} onChange={(e) => set({ emailNotifications: e.target.checked })} /><span>Manager alert and weekly summary emails</span></label>
      <div className="row mt-sm"><button className="btn primary" type="submit" disabled={a.busy}>{a.busy ? 'Saving…' : 'Save'}</button></div>
    </form>
  );
}

function MembersCard({ t, reload }: { t: TeamDetail; reload: () => void }) {
  const a = useAction();
  const { ctx } = useApp();
  const act = (m: Member, data: Record<string, unknown>, ok: string) => a.run(async () => { await ownerApi.act('updateMember', { userId: m.userId, ...data }); reload(); }, ok);
  return (
    <div className="card table-wrap">
      <h2>People ({t.members.length} of {t.seatLimit} seats)</h2>
      {a.feedback}
      {t.members.length === 0 ? <p className="muted">No one has joined yet.</p> : (
        <table className="rtable">
          <thead><tr><th>Person</th><th>Role</th><th>Access</th><th>Sessions</th><th>Last sign-in</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{t.members.map((m) => (
            <tr key={m.userId}>
              <td className="rt-main"><strong>{m.name ?? m.email}</strong><div className="small muted">{m.email}</div></td>
              <td data-label="Role">
                <select aria-label={`Role for ${m.email}`} value={m.role} disabled={a.busy} onChange={(e) => void act(m, { role: e.target.value }, `${m.email} is now a ${e.target.value}.`)}>
                  <option value="rep">Rep</option><option value="manager">Manager</option>
                </select>
              </td>
              <td data-label="Access">{m.active ? <span className="tag teal">On</span> : <span className="tag red">Off</span>}</td>
              <td data-label="Sessions">{m.sessions}</td>
              <td data-label="Last sign-in" className="small">{ago(m.lastSignInAt)}</td>
              <td className="row owner-actions">
                {m.userId !== ctx?.user?.id && <button className="btn" disabled={a.busy} onClick={() => void act(m, { active: !m.active }, m.active ? `Access turned off for ${m.email}.` : `Access turned on for ${m.email}.`)}>{m.active ? 'Turn off access' : 'Turn on access'}</button>}
                <button className="btn" disabled={a.busy} onClick={() => void a.run(() => ownerApi.act('resetPassword', { email: m.email }), `Password reset email sent to ${m.email}.`)}>Send password reset</button>
                {m.userId !== ctx?.user?.id && m.sessions === 0 && <button className="btn" disabled={a.busy} onClick={() => { if (confirm(`Remove ${m.email} from ${t.name}? Their account stays; they can be invited again.`)) void act(m, { remove: true }, `${m.email} removed.`); }}>Remove</button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

function DangerCard({ t, back, reload }: { t: TeamDetail; back: () => void; reload: () => void }) {
  const a = useAction();
  const [confirmName, setConfirmName] = useState('');
  const suspended = t.status === 'suspended';
  return (
    <div className="card owner-danger">
      <h2>Suspend or delete</h2>
      {a.feedback}
      <p className="small">{suspended ? 'This team is suspended: nobody in it can sign in to practise or manage. Nothing is deleted.' : 'Suspending locks everyone in this team out straight away and ends any practice in progress. Nothing is deleted, and you can turn it back on any time.'}</p>
      <button className={`btn ${suspended ? 'primary' : ''}`} disabled={a.busy} onClick={() => { if (suspended || confirm(`Suspend ${t.name}? Everyone in it loses access until you reactivate it.`)) void a.run(async () => { await ownerApi.act('updateTeam', { agencyId: t.id, status: suspended ? 'active' : 'suspended' }); reload(); }, suspended ? 'Team reactivated.' : 'Team suspended.'); }}>
        {suspended ? 'Reactivate team' : 'Suspend team'}
      </button>
      <hr />
      <p className="small"><strong>Delete for good:</strong> removes the team and all its practice sessions, feedback, campaign and history. People keep their sign-in accounts. This can’t be undone, so download their data first if it’s needed.</p>
      <div className="field"><label htmlFor="del-name">Type <strong>{t.name}</strong> to confirm</label><input id="del-name" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" /></div>
      <button className="btn danger" disabled={a.busy || confirmName !== t.name} onClick={() => void a.run(async () => { await ownerApi.act('deleteTeam', { agencyId: t.id, confirmName }); back(); }, 'Team deleted.')}>Delete team</button>
    </div>
  );
}

/* ------------------------------------------------------------------ users */
function UsersTab({ openTeam }: { openTeam: (id: string) => void }) {
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<'all' | 'noteam' | 'off'>('all');
  const q = useAsync(() => ownerApi.view<UserRow[]>('users', { q: query }), [query]);
  const a = useAction();
  const { ctx } = useApp();
  useEffect(() => { const h = setTimeout(() => setQuery(term.trim()), 300); return () => clearTimeout(h); }, [term]);
  const rows = (q.data ?? []).filter((u) => show === 'all' || (show === 'noteam' ? !u.agencyId : u.agencyId && !u.active));
  return (
    <>
      <div className="row">
        <div className="field m0 owner-search"><label htmlFor="user-q" className="sr-only">Search people</label><input id="user-q" type="search" placeholder="Search by email, name or team" value={term} onChange={(e) => setTerm(e.target.value)} /></div>
        <div className="field m0"><label htmlFor="user-show" className="sr-only">Show</label>
          <select id="user-show" value={show} onChange={(e) => setShow(e.target.value as any)}><option value="all">Everyone</option><option value="noteam">No team</option><option value="off">Access off</option></select></div>
      </div>
      {a.feedback}
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : rows.length === 0 ? <Empty>No one matches.</Empty> : (
        <div className="card table-wrap">
          <table className="rtable">
            <thead><tr><th>Person</th><th>Team</th><th>Role</th><th>Joined</th><th>Last sign-in</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{rows.map((u) => (
              <tr key={u.userId}>
                <td className="rt-main"><strong>{u.name ?? u.email}</strong><div className="small muted">{u.email}{!u.confirmed && ' · email not confirmed'}</div></td>
                <td data-label="Team">{u.agencyId ? <button className="btn link owner-rowlink" onClick={() => openTeam(u.agencyId!)}>{u.agencyName}</button> : <span className="muted">None</span>}{u.agencyStatus === 'suspended' && <span className="tag red"> Suspended</span>}</td>
                <td data-label="Role">{u.role ? <>{u.role}{u.active ? '' : <span className="tag red"> off</span>}</> : '–'}</td>
                <td data-label="Joined" className="small">{fmtDate(u.createdAt)}</td>
                <td data-label="Last sign-in" className="small">{ago(u.lastSignInAt)}</td>
                <td className="row owner-actions">
                  {u.agencyId && u.userId !== ctx?.user?.id && <button className="btn" disabled={a.busy} onClick={() => void a.run(async () => { await ownerApi.act('updateMember', { userId: u.userId, active: !u.active }); q.reload(); }, u.active ? `Access turned off for ${u.email}.` : `Access turned on for ${u.email}.`)}>{u.active ? 'Turn off access' : 'Turn on access'}</button>}
                  <button className="btn" disabled={a.busy} onClick={() => void a.run(() => ownerApi.act('resetPassword', { email: u.email }), `Password reset email sent to ${u.email}.`)}>Password reset</button>
                  {!u.agencyId && u.userId !== ctx?.user?.id && <button className="btn danger" disabled={a.busy} onClick={() => {
                    const typed = prompt(`Delete the account ${u.email} for good? Type the email address to confirm.`);
                    if (typed !== null) void a.run(async () => { await ownerApi.act('deleteUser', { userId: u.userId, confirmEmail: typed.trim().toLowerCase() }); q.reload(); }, `Account ${u.email} deleted.`);
                  }}>Delete account</button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
          {(q.data?.length ?? 0) >= 500 && <p className="small muted">Showing the newest 500. Search to find others.</p>}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ features */
function FeaturesTab() {
  const q = useAsync(() => ownerApi.view<{ settings: Settings; env: { pilotsSwitch: boolean; emails: boolean; liveAi: boolean } }>('settings'), []);
  const { refresh } = useApp();
  const a = useAction();
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => { if (q.data) setS(q.data.settings); }, [q.data]);
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorBox message={q.error} onRetry={q.reload} />;
  if (!s) return <Loading />;
  const env = q.data!.env;
  const set = (p: Partial<Settings>) => setS((x) => ({ ...x!, ...p }));
  const save = (patch: Partial<Settings>, ok: string) => a.run(async () => {
    const out = await ownerApi.act<Settings>('settings', { settings: patch });
    setS(out); await refresh();
  }, ok);
  return (
    <>
      {a.feedback}
      <div className={`card ${s.practicePaused ? 'owner-danger' : ''}`}>
        <h2>Practice</h2>
        <p className="small">{s.practicePaused ? 'Practice is paused: nobody can start a new session. Sessions already running finish normally.' : 'Practice is running normally.'}</p>
        <div className="field"><label htmlFor="f-pmsg">Message people see while it’s paused</label><input id="f-pmsg" maxLength={300} placeholder="Practice is paused for a short while. Please try again later." value={s.practicePausedMessage ?? ''} onChange={(e) => set({ practicePausedMessage: e.target.value })} /></div>
        <div className="row">
          <button className={`btn ${s.practicePaused ? 'primary' : 'danger'}`} disabled={a.busy} onClick={() => { if (s.practicePaused || confirm('Pause practice for every team? Nobody can start a new session until you turn it back on.')) void save({ practicePaused: !s.practicePaused, practicePausedMessage: s.practicePausedMessage ?? '' }, s.practicePaused ? 'Practice is back on.' : 'Practice paused.'); }}>
            {s.practicePaused ? 'Turn practice back on' : 'Pause practice for everyone'}
          </button>
          {s.practicePaused && <button className="btn" disabled={a.busy} onClick={() => void save({ practicePausedMessage: s.practicePausedMessage ?? '' }, 'Message saved.')}>Save message</button>}
        </div>
      </div>

      <div className="card">
        <h2>Voice</h2>
        <label className="check"><input type="checkbox" checked={s.voiceEnabled} disabled={a.busy} onChange={(e) => void save({ voiceEnabled: e.target.checked }, e.target.checked ? 'Voice turned on.' : 'Voice turned off: everyone types for now.')} />
          <span>Speaking and the customer’s voice (Deepgram). Turn off to save cost or if the voice service has problems; people can still type.</span></label>
      </div>

      <form className="card" onSubmit={(e) => { e.preventDefault(); void save({ pilotsEnabled: s.pilotsEnabled, pilotSeconds: s.pilotSeconds, pilotDays: s.pilotDays, pilotDailyCap: s.pilotDailyCap }, 'Free pilot settings saved.'); }}>
        <h2>Free pilots</h2>
        {!env.pilotsSwitch && <div className="alert warn">Free pilots are switched off in Railway (SELF_SERVE_PILOTS=false), which overrides this.</div>}
        <label className="check"><input type="checkbox" checked={s.pilotsEnabled} onChange={(e) => set({ pilotsEnabled: e.target.checked })} /><span>Anyone can sign up and start a free pilot for their team</span></label>
        <div className="owner-form-grid">
          <div className="field"><label htmlFor="f-pmin">Practice minutes</label><input id="f-pmin" type="number" min={1} max={6000} value={Math.round(s.pilotSeconds / 60)} onChange={(e) => set({ pilotSeconds: Number(e.target.value) * 60 })} /></div>
          <div className="field"><label htmlFor="f-pdays">Lasts (days)</label><input id="f-pdays" type="number" min={1} max={90} value={s.pilotDays} onChange={(e) => set({ pilotDays: Number(e.target.value) })} /></div>
          <div className="field"><label htmlFor="f-pcap">New pilots a day (limit)</label><input id="f-pcap" type="number" min={0} max={1000} value={s.pilotDailyCap} onChange={(e) => set({ pilotDailyCap: Number(e.target.value) })} /></div>
        </div>
        <p className="small muted">Changes apply to new pilots. The website shows these numbers. To give an existing pilot more time, open it under Teams.</p>
        <button className="btn primary" type="submit" disabled={a.busy}>Save</button>
      </form>

      <form className="card" onSubmit={(e) => { e.preventDefault(); void save({ announcement: s.announcement ?? '', announcementTone: s.announcementTone }, s.announcement ? 'Announcement is live.' : 'Announcement removed.'); }}>
        <h2>Announcement</h2>
        <p className="small muted">A short message at the top of every page, for everyone. Leave empty to remove it.</p>
        <div className="field"><label htmlFor="f-ann">Message</label><textarea id="f-ann" rows={2} maxLength={300} value={s.announcement ?? ''} onChange={(e) => set({ announcement: e.target.value })} /></div>
        <div className="field"><label htmlFor="f-tone">Style</label><select id="f-tone" value={s.announcementTone} onChange={(e) => set({ announcementTone: e.target.value as 'info' | 'warn' })}><option value="info">News (blue)</option><option value="warn">Warning (yellow)</option></select></div>
        <div className="row"><button className="btn primary" type="submit" disabled={a.busy}>Save</button>{s.announcement && <button type="button" className="btn" disabled={a.busy} onClick={() => void save({ announcement: '' }, 'Announcement removed.')}>Remove</button>}</div>
      </form>

      <div className="card">
        <h2>Set in Railway</h2>
        <dl className="owner-dl">
          <dt>Emails (Resend)</dt><dd>{env.emails ? <span className="tag teal">On</span> : <span className="tag red">Off</span>}</dd>
          <dt>Live AI customer and feedback</dt><dd>{env.liveAi ? <span className="tag teal">On</span> : <span className="tag red">Off</span>}</dd>
        </dl>
        <p className="small muted m0">These need keys, so they’re changed in Railway’s Variables rather than here.</p>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ messages */
function MessagesTab() {
  const [status, setStatus] = useState('open');
  const q = useAsync(() => ownerApi.view<Message[]>('messages', { status }), [status]);
  const a = useAction();
  const mark = (m: Message, s: string) => a.run(async () => { await ownerApi.act('messageStatus', { id: m.id, status: s }); q.reload(); });
  return (
    <>
      <div className="field m0 owner-search"><label htmlFor="msg-status">Show</label>
        <select id="msg-status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">New</option><option value="replied">Replied</option><option value="closed">Closed</option><option value="spam">Spam</option><option value="all">All</option></select></div>
      {a.feedback}
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : (q.data ?? []).length === 0 ? <Empty>No messages here.</Empty> : (
        <ul className="owner-messages">{q.data!.map((m) => (
          <li key={m.id} className="card">
            <div className="spread"><h3 className="m0">{m.name}{m.company ? ` · ${m.company}` : ''}</h3><span className="small muted">{fmtDate(m.createdAt)}</span></div>
            <p className="small muted m0">{m.email}{m.teamSize ? ` · ${m.teamSize}` : ''}{m.salesType ? ` · ${m.salesType}` : ''} · <span className="tag">{m.status}</span></p>
            <p className="owner-msg">{m.message}</p>
            <div className="row">
              <a className="btn primary" href={`mailto:${m.email}?subject=${encodeURIComponent('Your PitchReady enquiry')}`} onClick={() => { if (m.status === 'new') void mark(m, 'replied'); }}>Reply by email</a>
              {m.status !== 'replied' && <button className="btn" disabled={a.busy} onClick={() => void mark(m, 'replied')}>Mark replied</button>}
              {m.status !== 'closed' && <button className="btn" disabled={a.busy} onClick={() => void mark(m, 'closed')}>Close</button>}
              {m.status !== 'spam' && <button className="btn" disabled={a.busy} onClick={() => void mark(m, 'spam')}>Spam</button>}
              {m.status !== 'new' && <button className="btn link" disabled={a.busy} onClick={() => void mark(m, 'new')}>Mark as new</button>}
            </div>
          </li>
        ))}</ul>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ activity */
function ActivityTab() {
  const [mine, setMine] = useState(false);
  const q = useAsync(() => ownerApi.view<Activity[]>('activity', mine ? { ownerOnly: '1' } : {}), [mine]);
  return (
    <>
      <label className="check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /><span>Only changes made in the owner suite</span></label>
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : (q.data ?? []).length === 0 ? <Empty>Nothing yet.</Empty> : (
        <div className="card table-wrap">
          <table className="rtable">
            <thead><tr><th>When</th><th>What</th><th>Team</th><th>Who</th></tr></thead>
            <tbody>{q.data!.map((e, i) => (
              <tr key={i}><td className="rt-main small">{new Date(e.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                <td data-label="What">{label(e.action)}{e.action === 'owner_team_deleted' && typeof e.metadata?.name === 'string' ? `: ${e.metadata.name}` : ''}</td>
                <td data-label="Team">{e.team ?? <span className="muted">–</span>}</td><td data-label="Who" className="small">{e.actor}</td></tr>
            ))}</tbody>
          </table>
          <p className="small muted">The newest 200 events.</p>
        </div>
      )}
    </>
  );
}
