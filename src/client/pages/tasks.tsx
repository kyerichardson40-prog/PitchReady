'use client';
/**
 * Practice tasks (DECISIONS D44): a manager asks for "the price objection 3 times by Friday";
 * reps see it at the top of Practise with their progress and a tick when done.
 */
import { useMemo, useState } from 'react';
import { TASK_MAX_TARGET, TASK_NOTE_MAX, dueText, taskProgress, taskState, type PracticeTask } from '../../../lib/domain/tasks.ts';
import { useApp, useAsync } from '../app-context.tsx';
import { Link } from '../router.tsx';
import { ErrorBox, Loading } from '../components/ui.tsx';
import { useManagerGuard } from './manager-guard.tsx';

const STATE_TAG = {
  done: <span className="tag teal">✓ Done</span>,
  overdue: <span className="tag red">Overdue</span>,
  due_soon: <span className="tag amber">Due soon</span>,
  open: null,
} as const;

/** End of the chosen day (local time), as an ISO string; empty means no due date. */
function endOfDay(date: string): string | null {
  if (!date) return null;
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 0).toISOString();
}
const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** This Friday, or next Friday if it's Friday already or later. */
function nextFriday(now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + (((5 - d.getDay() + 7) % 7) || 7));
  return isoDate(d);
}

export function ManagerTasksPage() {
  const guard = useManagerGuard();
  const { repo, ctx } = useApp();
  const isManager = ctx?.user?.role === 'manager';
  const [showArchived, setShowArchived] = useState(false);
  const q = useAsync(() => (isManager ? repo.listTasks({ includeArchived: showArchived }) : Promise.resolve([])), [repo, isManager, showArchived]);
  const roster = useAsync(() => (isManager ? repo.getRoster() : Promise.resolve(null)), [repo, isManager]);
  const reps = useMemo(() => (roster.data?.members ?? []).filter((m) => m.role === 'rep' && m.active), [roster.data]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  if (guard) return guard;
  const tasks = q.data ?? [];
  const live = tasks.filter((t) => !t.archived);
  const archived = tasks.filter((t) => t.archived);
  const archive = async (t: PracticeTask) => {
    setErr(null); setMsg(null);
    try { await repo.archiveTask(t.id); setMsg(`“${t.scenarioTitle}” archived. Reps won’t see it any more.`); q.reload(); } catch (e: any) { setErr(e.message); }
  };
  return (
    <div className="stack">
      <div className="spread">
        <h1 className="m0">Practice tasks</h1>
        {!creating && <button className="btn primary" onClick={() => { setMsg(null); setErr(null); setCreating(true); }}>New task</button>}
      </div>
      <p className="small muted">Ask your reps to practise a scenario a number of times by a date. They see it at the top of their Practise page, with a tick when they’re done. Reps who haven’t finished get a reminder email the day before it’s due.</p>
      {msg && <div className="alert info" role="status">{msg}</div>}
      {err && <ErrorBox message={err} />}
      {creating && ctx && (
        <TaskForm scenarios={ctx.scenarios.map((s) => ({ key: s.key, title: s.title }))} reps={reps.map((r) => ({ id: r.userId, name: r.name, assigned: r.assignedKeys }))}
          onCancel={() => setCreating(false)}
          onSave={async (input) => {
            setErr(null);
            try {
              const t = await repo.createTask(input);
              setCreating(false);
              setMsg(`Task set: ${t.scenarioTitle}, ${t.target} time${t.target === 1 ? '' : 's'}${t.dueAt ? `, ${dueText(t.dueAt).toLowerCase()}` : ''}.`);
              q.reload();
            } catch (e: any) { setErr(e.message); }
          }} />
      )}
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : (
        <>
          {live.length === 0 && !creating && <div className="card"><p className="m0">No tasks yet. Try something like “Practise <em>{ctx?.scenarios[0]?.title ?? 'a scenario'}</em> 3 times by Friday”.</p></div>}
          {live.map((t) => <ManagerTaskCard key={t.id} t={t} onArchive={() => void archive(t)} />)}
          <label className="row small"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived tasks (last 60 days)</label>
          {showArchived && (archived.length === 0 ? <p className="small muted">No archived tasks.</p> : archived.map((t) => <ManagerTaskCard key={t.id} t={t} />))}
        </>
      )}
    </div>
  );
}

function ManagerTaskCard({ t, onArchive }: { t: PracticeTask; onArchive?: () => void }) {
  const p = taskProgress(t);
  const now = new Date();
  return (
    <div className={`card task-card${t.archived ? ' muted' : ''}`}>
      <div className="spread">
        <div>
          <h2 className="m0">{t.scenarioTitle} × {t.target}</h2>
          <p className="small muted m0">{dueText(t.dueAt)} · {t.everyone ? 'Everyone' : `${p.total} rep${p.total === 1 ? '' : 's'}`} · set by {t.createdBy}{t.archived ? ' · archived' : ''}</p>
        </div>
        <div className="row">
          <span className={`tag ${p.finished === p.total && p.total > 0 ? 'teal' : p.overdue ? 'red' : ''}`}>{p.finished} of {p.total} done</span>
          {onArchive && <button className="btn" onClick={onArchive} aria-label={`Archive ${t.scenarioTitle} task`}>Archive</button>}
        </div>
      </div>
      {t.note && <p className="task-note">“{t.note}”</p>}
      {p.total === 0 ? <p className="small muted">No active reps on this task.</p> : (
        <ul className="task-reps">
          {t.assignees.map((a) => (
            <li key={a.userId}>
              <span className="task-rep-name"><Link to={`/manager/reps/${a.userId}`}>{a.name}</Link></span>
              <span className="task-dots" aria-label={`${a.done} of ${t.target} done`}>
                {Array.from({ length: t.target }, (_, i) => <span key={i} className={i < a.done ? 'on' : ''} />)}
              </span>
              <span className="small">{a.done} of {t.target}</span>
              {STATE_TAG[taskState(t, a.done, now)]}
              {!a.canPractise && <span className="tag amber" title="Assign this scenario from their profile so they can practise it">Scenario not assigned</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TaskForm({ scenarios, reps, onSave, onCancel }: {
  scenarios: { key: string; title: string }[]; reps: { id: string; name: string; assigned: string[] }[];
  onSave: (input: { scenarioKey: string; target: number; dueAt: string | null; note?: string; repIds: string[] | null }) => Promise<void>; onCancel: () => void;
}) {
  const [scenarioKey, setScenario] = useState(scenarios[0]?.key ?? '');
  const [target, setTarget] = useState(3);
  const [due, setDue] = useState(nextFriday());
  const [note, setNote] = useState('');
  const [who, setWho] = useState<'all' | 'some'>('all');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const blocked = reps.filter((r) => (who === 'all' || picked.includes(r.id)) && r.assigned.length > 0 && !r.assigned.includes(scenarioKey));
  return (
    <form className="card stack" onSubmit={async (e) => {
      e.preventDefault();
      if (who === 'some' && picked.length === 0) { setProblem('Choose at least one rep.'); return; }
      setProblem(null); setBusy(true);
      try { await onSave({ scenarioKey, target, dueAt: endOfDay(due), note: note.trim() || undefined, repIds: who === 'all' ? null : picked }); } finally { setBusy(false); }
    }}>
      <h2 className="m0">New practice task</h2>
      <div className="grid two">
        <div><label htmlFor="task-scenario">Scenario</label>
          <select id="task-scenario" value={scenarioKey} onChange={(e) => setScenario(e.target.value)}>
            {scenarios.map((s) => <option key={s.key} value={s.key}>{s.title}</option>)}
          </select></div>
        <div><label htmlFor="task-target">How many times</label>
          <input id="task-target" type="number" min={1} max={TASK_MAX_TARGET} value={target} onChange={(e) => setTarget(Math.max(1, Math.min(TASK_MAX_TARGET, Number(e.target.value) || 1)))} /></div>
        <div><label htmlFor="task-due">Due by (end of day)</label>
          <input id="task-due" type="date" min={isoDate(new Date())} value={due} onChange={(e) => setDue(e.target.value)} />
          <span className="small muted">Leave empty for no due date.</span></div>
        <fieldset><legend>Who</legend>
          <label className="row"><input type="radio" name="task-who" checked={who === 'all'} onChange={() => setWho('all')} /> Everyone on the team</label>
          <label className="row"><input type="radio" name="task-who" checked={who === 'some'} onChange={() => setWho('some')} /> Choose reps</label>
        </fieldset>
      </div>
      {who === 'some' && (
        <div className="row wrap" role="group" aria-label="Reps">
          {reps.length === 0 ? <span className="small muted">No active reps yet.</span> : reps.map((r) => (
            <label key={r.id} className="chip-check"><input type="checkbox" checked={picked.includes(r.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.id] : p.filter((x) => x !== r.id)))} /> {r.name}</label>
          ))}
        </div>
      )}
      <div><label htmlFor="task-note">Note for your reps (optional)</label>
        <textarea id="task-note" rows={2} maxLength={TASK_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Ready for Saturday’s shift: lead with the £10 example." /></div>
      {blocked.length > 0 && <div className="alert warn small">{blocked.map((r) => r.name).join(', ')} {blocked.length === 1 ? 'doesn’t' : 'don’t'} have this scenario assigned, so they can’t practise it yet. Assign it from their profile in Team.</div>}
      {problem && <ErrorBox message={problem} />}
      <div className="row">
        <button className="btn primary" type="submit" disabled={busy || !scenarioKey}>{busy ? 'Saving…' : 'Set task'}</button>
        <button className="btn" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** Rep: "From your manager" at the top of Practise. Hidden when there are no tasks. */
export function RepTasksCard() {
  const { repo, ctx } = useApp();
  const isRep = ctx?.user?.role === 'rep';
  const q = useAsync(() => (isRep ? repo.listTasks() : Promise.resolve([] as PracticeTask[])), [repo, isRep]);
  const tasks = (q.data ?? []).flatMap((t) => (t.assignees[0] ? [{ t, me: t.assignees[0] }] : []));
  if (!isRep || tasks.length === 0) return null;
  const now = new Date();
  const order = { overdue: 0, due_soon: 1, open: 2, done: 3 };
  const rows = tasks.map(({ t, me }) => ({ t, me, done: me.done, state: taskState(t, me.done, now) }))
    .sort((a, b) => order[a.state] - order[b.state]);
  return (
    <div className="card task-inbox">
      <h2 className="m0">From your manager</h2>
      <ul className="todo-list">
        {rows.map(({ t, me, done, state }) => (
          <li key={t.id} className={state === 'done' ? 'is-done' : ''}>
            <span className={`task-check${state === 'done' ? ' on' : ''}`} aria-hidden="true">{state === 'done' ? '✓' : ''}</span>
            <span className="todo-text">
              <strong>Practise “{t.scenarioTitle}” {t.target} time{t.target === 1 ? '' : 's'}</strong>
              <span className="small muted"> · {state === 'done' ? 'Done, nice work' : `${done} of ${t.target} done`} · {dueText(t.dueAt, now)}</span>
              {t.note && <span className="small task-note-inline">“{t.note}”</span>}
            </span>
            {STATE_TAG[state === 'done' ? 'open' : state]}
            {state !== 'done' && (me.canPractise
              ? <Link className="btn primary" to={`/practice/${t.scenarioKey}`}>Practise now</Link>
              : <span className="small muted">Ask your manager to assign this scenario</span>)}
          </li>
        ))}
      </ul>
    </div>
  );
}
