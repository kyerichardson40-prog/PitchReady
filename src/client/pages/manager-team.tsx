'use client';
/**
 * Manager: rep database (directory + profiles) and scenarios (create, edit, archive, assign).
 * Same screens in demo and connected mode; data comes from the repository. DECISIONS.md D25.
 */
import { useEffect, useMemo, useState } from 'react';
import { DEMO_RUBRIC } from '../../../lib/content/rubric.ts';
import { MIN_SAMPLE, type RepDirectoryRow } from '../../../lib/domain/metrics.ts';
import { scenarioInput } from '../../../lib/domain/schemas.ts';
import { useApp, useAsync } from '../app-context.tsx';
import { Link } from '../router.tsx';
import type { ScenarioAdmin, ScenarioFields } from '../repo/types.ts';
import { Empty, ErrorBox, Loading, StatusTag, fmtDate, sessionTitle } from '../components/ui.tsx';
import { useManagerGuard } from './manager-guard.tsx';

const dimLabel = (k: string) => DEMO_RUBRIC.dimensions.find((d) => d.key === k)?.label ?? k;

function scenarioSummary(keys: string[], admin: ScenarioAdmin | null): string {
  if (!keys.length) return 'All scenarios';
  const titles = keys.map((k) => admin?.scenarios.find((s) => s.key === k)?.title ?? k);
  return titles.length <= 2 ? titles.join(', ') : `${titles.length} scenarios`;
}

// ------------------------------------------------------------------ rep database
export function RepDirectory({ members, admin }: { members: RepDirectoryRow[]; admin: ScenarioAdmin | null }) {
  const [q, setQ] = useState('');
  const [show, setShow] = useState<'active' | 'all'>('active');
  const reps = members.filter((m) => m.role === 'rep')
    .filter((m) => show === 'all' || m.active)
    .filter((m) => !q.trim() || `${m.name} ${m.email}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="card table-wrap">
      <div className="spread">
        <h2>Rep database</h2>
        <span className="small muted">{members.filter((m) => m.role === 'rep' && m.active).length} active reps</span>
      </div>
      <div className="row">
        <div className="field grow"><label htmlFor="rep-search">Search reps</label><input id="rep-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" /></div>
        <div className="field"><label htmlFor="rep-show">Show</label>
          <select id="rep-show" value={show} onChange={(e) => setShow(e.target.value as 'active')}><option value="active">Active reps</option><option value="all">All reps, incl. deactivated</option></select>
        </div>
      </div>
      {reps.length === 0 ? <p className="muted">No reps match.</p> : (
        <table className="rtable">
          <thead><tr><th>Rep</th><th>Status</th><th>Scenarios</th><th>Sessions</th><th>Last practice</th><th>Avg score</th><th>Open flags</th></tr></thead>
          <tbody>{reps.map((m, i) => (
            <tr key={m.userId}>
              <td className="rt-main"><span className="person"><span className={`avatar paint-bg-${i % 4}`} aria-hidden="true">{initials(m.name)}</span><span><Link to={`/manager/reps/${m.userId}`}>{m.name}</Link><br /><span className="small muted">{m.email}</span></span></span></td>
              <td data-label="Status">{m.active ? <span className="tag teal">Active</span> : <span className="tag">Deactivated</span>}</td>
              <td data-label="Scenarios" className="small">{scenarioSummary(m.assignedKeys, admin)}</td>
              <td data-label="Sessions">{m.sessions}</td>
              <td data-label="Last practice" className="small">{m.lastPracticeAt ? fmtDate(m.lastPracticeAt) : '—'}</td>
              <td data-label="Avg score">{m.meanScore === null ? <span className="small muted">—</span> : <span className="mean"><span className="mean-num">{m.meanScore}</span><span className="mean-bar" aria-hidden="true"><span style={{ width: `${(m.meanScore / 5) * 100}%` }} /></span><span className="small muted">{m.scoredSessions} session{m.scoredSessions === 1 ? '' : 's'}</span></span>}</td>
              <td data-label="Open flags">{m.openFlags ? <span className="tag amber">{m.openFlags}</span> : '0'}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <p className="small muted">Average score: observed scores on the current rubric only; “not observed” is never counted as zero. Read small numbers with care.</p>
    </div>
  );
}

// ------------------------------------------------------------------ rep profile
export function RepProfilePage({ id }: { id: string }) {
  const guard = useManagerGuard();
  const { repo, ctx } = useApp();
  const isManager = ctx?.user?.role === 'manager';
  const q = useAsync(() => (isManager ? repo.getRepProfile(id) : Promise.resolve(null)), [repo, id, isManager]);
  const admin = useAsync(() => (isManager ? repo.getScenarioAdmin() : Promise.resolve(null)), [repo, isManager]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (guard) return guard;
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorBox message={q.error} onRetry={q.reload} />;
  if (!q.data) return null;
  const { member: m, sessions, breakdown, minutesUsed, rubricVersion } = q.data;
  const act = async (fn: () => Promise<unknown>, done: string) => { setErr(null); setMsg(null); try { await fn(); setMsg(done); q.reload(); admin.reload(); } catch (e: any) { setErr(e.message); } };
  return (
    <div className="stack">
      <p className="small"><Link to="/manager/reps">← Team</Link></p>
      <div className="spread">
        <h1 className="m0">{m.name}</h1>
        {m.active ? <span className="tag teal">Active</span> : <span className="tag">Deactivated</span>}
      </div>
      <p className="small muted">{m.email} · {m.role}</p>
      {msg && <div className="alert info" role="status">{msg}</div>}
      {err && <ErrorBox message={err} />}
      <div className="grid three">
        <div className="card stat stat-tile tile-teal"><span className="small muted">Sessions</span><strong>{m.sessions}</strong><span className="small muted">{m.completed} with feedback</span></div>
        <div className="card stat stat-tile tile-mustard"><span className="small muted">Practice time</span><strong>{minutesUsed} min</strong><span className="small muted">Last: {m.lastPracticeAt ? fmtDate(m.lastPracticeAt) : 'never'}</span></div>
        <div className={`card stat stat-tile ${m.openFlags > 0 ? 'tile-red' : 'tile-plain'}`}><span className="small muted">Open flags</span><strong>{m.openFlags}</strong><span className="small muted">Concerns and reports to review</span></div>
      </div>

      <div className="card table-wrap">
        <h2>Skills (rubric {rubricVersion})</h2>
        <table className="rtable">
          <thead><tr><th>Area</th><th>Average</th><th>Observed</th><th>Not observed</th></tr></thead>
          <tbody>{breakdown.map((d) => (
            <tr key={d.key}><td className="rt-main"><strong>{dimLabel(d.key)}</strong></td><td data-label="Average">{d.mean === null ? '—' : <span className="mean"><span className="mean-num">{d.mean}</span><span className="mean-bar" aria-hidden="true"><span style={{ width: `${(d.mean / 5) * 100}%` }} /></span>{!d.enoughData && <span className="small muted">fewer than {MIN_SAMPLE}</span>}</span>}</td><td data-label="Observed">{d.observed}</td><td data-label="Not observed">{d.notObserved}</td></tr>
          ))}</tbody>
        </table>
      </div>

      {m.role === 'rep' && (admin.data
        ? <AssignmentEditor key={m.assignedKeys.join(',')} userId={m.userId} name={m.name} assigned={m.assignedKeys} admin={admin.data} onSave={(keys) => act(() => repo.setScenarioAssignments(m.userId, keys), keys.length ? `Saved: ${m.name} now practises ${keys.length} scenario${keys.length === 1 ? '' : 's'}.` : `Saved: ${m.name} can practise every active scenario.`)} />
        : admin.error ? <ErrorBox message={admin.error} onRetry={admin.reload} /> : <Loading />)}

      <div className="card table-wrap">
        <h2>Practice history</h2>
        {sessions.length === 0 ? <p className="muted">No practice yet.</p> : (
          <table className="rtable">
            <thead><tr><th>Scenario</th><th>Ended</th><th>Status</th><th>Flags</th></tr></thead>
            <tbody>{sessions.map((s) => (
              <tr key={s.id}><td className="rt-main"><Link to={`/manager/sessions/${s.id}`}>{sessionTitle({ scenarioKey: s.scenarioKey, scenarioTitle: s.scenarioTitle, drillKey: s.drillKey as never })}</Link></td><td data-label="Ended" className="small">{fmtDate(s.endedAt)}</td><td data-label="Status"><StatusTag s={s} /></td><td data-label="Flags">{s.openConcerns + s.openReports || '0'}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>

      {m.userId !== ctx?.user?.id && (
        <div className="card danger-zone">
          <h2>Access</h2>
          {m.active
            ? <><p className="small">Deactivating removes access immediately, including any practice in progress. Their history stays.</p><button className="btn danger" onClick={() => { if (confirm(`Deactivate ${m.name}?`)) void act(() => repo.setMemberActive(m.userId, false), `${m.name} has been deactivated.`); }}>Deactivate</button></>
            : <button className="btn" onClick={() => void act(() => repo.setMemberActive(m.userId, true), `${m.name} has been reactivated.`)}>Reactivate</button>}
        </div>
      )}
    </div>
  );
}

function AssignmentEditor({ userId, name, assigned, admin, onSave }: { userId: string; name: string; assigned: string[]; admin: ScenarioAdmin; onSave: (keys: string[]) => void }) {
  const active = admin.scenarios.filter((s) => !s.archived);
  const [mode, setMode] = useState<'all' | 'some'>(assigned.length ? 'some' : 'all');
  const [keys, setKeys] = useState<string[]>(assigned);
  const toggle = (k: string) => setKeys((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); onSave(mode === 'all' ? [] : keys); }}>
      <h2>Scenarios for {name.split(' ')[0]}</h2>
      <fieldset className="stack">
        <legend className="visually-hidden">Which scenarios can {name} practise?</legend>
        <label className="account-option"><input type="radio" name={`mode-${userId}`} checked={mode === 'all'} onChange={() => setMode('all')} /> Every active scenario</label>
        <label className="account-option"><input type="radio" name={`mode-${userId}`} checked={mode === 'some'} onChange={() => setMode('some')} /> Only the scenarios I choose</label>
      </fieldset>
      {mode === 'some' && (
        <fieldset className="stack" style={{ marginTop: '0.75rem' }}>
          <legend>Choose scenarios</legend>
          {active.map((s) => (
            <label key={s.key} className="account-option"><input type="checkbox" checked={keys.includes(s.key)} onChange={() => toggle(s.key)} /> <span>{s.title} <span className="small muted">· {s.skill}</span></span></label>
          ))}
        </fieldset>
      )}
      <button className="btn primary mt-sm" type="submit" disabled={mode === 'some' && keys.length === 0}>Save scenarios</button>
      {mode === 'some' && keys.length === 0 && <p className="small muted">Choose at least one, or pick “Every active scenario”.</p>}
    </form>
  );
}

// ------------------------------------------------------------------ scenarios
const EMPTY: ScenarioFields = { title: '', persona: '', opener: '', objection: '', goal: '', allowedEnding: '', behaviour: '', skill: '' };
const FIELDS: { k: keyof ScenarioFields; label: string; hint: string; long?: boolean }[] = [
  { k: 'title', label: 'Title', hint: 'What reps see in their list, e.g. “New to the street”.' },
  { k: 'persona', label: 'Resident', hint: 'Who answers the door, e.g. “Morgan, just moved in”.' },
  { k: 'opener', label: 'Opening line', hint: 'The first thing the resident says.', long: true },
  { k: 'objection', label: 'Main objection', hint: 'e.g. “Wants to settle in first”.' },
  { k: 'goal', label: 'Rep’s goal', hint: 'What a good rep does in this scenario.', long: true },
  { k: 'allowedEnding', label: 'Good endings', hint: 'Endings that count as success (a donation is never required).', long: true },
  { k: 'behaviour', label: 'How the resident behaves', hint: 'Used by the AI resident, e.g. “Friendly but distracted; ends politely if pressured”.', long: true },
  { k: 'skill', label: 'Skill practised', hint: 'e.g. “Rapport and brevity”.' },
];

export function ManagerScenariosPage() {
  const guard = useManagerGuard();
  const { repo, ctx, refresh } = useApp();
  const isManager = ctx?.user?.role === 'manager';
  const q = useAsync(() => (isManager ? repo.getScenarioAdmin() : Promise.resolve(null)), [repo, isManager]);
  const roster = useAsync(() => (isManager ? repo.getRoster() : Promise.resolve(null)), [repo, isManager]);
  const [editing, setEditing] = useState<{ key: string | null; fields: ScenarioFields } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const reps = useMemo(() => (roster.data?.members ?? []).filter((m) => m.role === 'rep' && m.active), [roster.data]);
  useEffect(() => { if (editing) document.getElementById('sc-title')?.focus(); }, [editing?.key, editing === null]); // eslint-disable-line react-hooks/exhaustive-deps
  if (guard) return guard;
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorBox message={q.error} onRetry={q.reload} />;
  if (!q.data) return null;
  const admin = q.data;
  const whoHas = (key: string) => {
    const names = reps.filter((r) => !r.assignedKeys.length || r.assignedKeys.includes(key)).map((r) => r.name.split(' ')[0]);
    return names.length === reps.length ? 'All active reps' : names.length ? names.join(', ') : 'No reps';
  };
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setErr(null); setMsg(null);
    try { await fn(); setMsg(done); q.reload(); roster.reload(); await refresh(); } catch (e: any) { setErr(e.message); }
  };
  const save = async () => {
    if (!editing) return;
    const parsed = scenarioInput.safeParse({ ...editing.fields, key: editing.key });
    if (!parsed.success) { setErr(`Check the form: ${[...new Set(parsed.error.issues.map((i) => FIELDS.find((f) => f.k === i.path[0])?.label ?? String(i.path[0])))].join(', ')} need text (within the length limit).`); return; }
    await act(async () => { const r = await repo.saveScenario(parsed.data); setEditing(null); return r; }, editing.key ? 'Scenario saved as a new version. Sessions already practised keep the version they used.' : 'Scenario created. Reps who see every scenario can practise it now; use a rep’s profile to assign it.');
  };
  return (
    <div className="stack">
      <div className="spread">
        <h1 className="m0">Scenarios</h1>
        {!editing && <button className="btn primary" onClick={() => { setMsg(null); setErr(null); setEditing({ key: null, fields: { ...EMPTY } }); }}>New scenario</button>}
      </div>
      <p className="small muted">Scenarios are the doorstep situations reps practise. Edit the five starter scenarios or write your own; the AI resident plays them using these fields. Choose who practises what from each rep’s profile in Team.</p>
      {msg && <div className="alert info" role="status">{msg}</div>}
      {err && <ErrorBox message={err} />}
      {editing && (
        <form className="card stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <h2>{editing.key ? `Edit: ${admin.scenarios.find((s) => s.key === editing.key)?.title}` : 'New scenario'}</h2>
          {FIELDS.map((f) => (
            <div className="field" key={f.k}>
              <label htmlFor={`sc-${f.k}`}>{f.label}</label>
              {f.long
                ? <textarea id={`sc-${f.k}`} value={editing.fields[f.k]} onChange={(e) => setEditing({ ...editing, fields: { ...editing.fields, [f.k]: e.target.value } })} />
                : <input id={`sc-${f.k}`} value={editing.fields[f.k]} onChange={(e) => setEditing({ ...editing, fields: { ...editing.fields, [f.k]: e.target.value } })} />}
              <span className="small muted">{f.hint}</span>
            </div>
          ))}
          <div className="row">
            <button className="btn primary" type="submit">{editing.key ? 'Save new version' : 'Create scenario'}</button>
            <button className="btn" type="button" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}
      {admin.scenarios.length === 0 ? <Empty>No scenarios yet.</Empty> : (
        <ul className="door-list">
          {admin.scenarios.map((s, i) => (
            <li key={s.key} className={`door-card door-card-static paint-${i % 4}${s.archived ? ' is-archived' : ''}`}>
              <span className="door-ico" aria-hidden="true"><span className="door-ico-light" /><span className="door-ico-leaf"><span className="door-ico-plate">{i + 1}</span></span></span>
              <div className="door-card-body">
              <div className="spread"><strong className="door-card-title">{s.title}</strong><span className="row">{s.archived ? <span className="tag">Archived</span> : <span className="tag teal">Active</span>}<span className="tag">v{s.version}</span></span></div>
              <span className="door-card-quote">“{s.opener}”</span>
              <p className="small m0">Resident: {s.persona} · Objection: {s.objection} · Skill: {s.skill}</p>
              {!s.archived && <p className="small muted m0">Practised by: {whoHas(s.key)}</p>}
              <div className="row mt-sm">
                {!s.archived && <button className="btn" aria-label={`Edit ${s.title}`} onClick={() => { setMsg(null); setErr(null); setEditing({ key: s.key, fields: { title: s.title, persona: s.persona, opener: s.opener, objection: s.objection, goal: s.goal, allowedEnding: s.allowedEnding, behaviour: s.behaviour, skill: s.skill } }); window.scrollTo(0, 0); }}>Edit</button>}
                {s.archived
                  ? <button className="btn" aria-label={`Restore ${s.title}`} onClick={() => void act(() => repo.setScenarioArchived(s.key, false), `${s.title} restored.`)}>Restore</button>
                  : <button className="btn danger" aria-label={`Archive ${s.title}`} onClick={() => { if (confirm(`Archive “${s.title}”? Reps can no longer start it; past sessions keep it.`)) void act(() => repo.setScenarioArchived(s.key, true), `${s.title} archived.`); }}>Archive</button>}
              </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function initials(name: string): string {
  const words = name.replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '?') + (words.length > 1 ? words[words.length - 1]![0] : '')).toUpperCase();
}
