import { useState } from 'react';
import { DEMO_RUBRIC } from '../../../lib/content/rubric.ts';
import type { EvaluationRecord, MustSay, PracticeSession } from '../../../lib/domain/types.ts';
import { ScoreDots, fmtDate } from './ui.tsx';
import { Transcript } from './Transcript.tsx';

const CONCERN_LABEL: Record<string, string> = {
  unsupported_campaign_claim: 'Possible unsupported campaign claim',
  ignored_stop_request: 'Possible ignored stop request',
  misstated_commitment: 'Possible misstated commitment',
  banned_phrase: 'Used a never-say phrase',
  other_review_needed: 'Needs a manager to look',
};

export function evaluatorLabel(e: EvaluationRecord): string {
  if (e.evaluatorKind === 'demo') return 'Demo feedback';
  if (e.evaluatorKind === 'mock') return 'Mock feedback (test provider — not AI)';
  return `AI feedback${e.model ? ` · ${e.model}` : ''}`;
}

export function FeedbackView({ session, audience, mustSay = [] }: { session: PracticeSession; audience: 'rep' | 'manager'; mustSay?: MustSay[] }) {
  const completed = session.evaluations.filter((e) => e.status === 'completed' && e.result);
  const [selectedId, setSelected] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const current = completed.find((e) => e.id === selectedId) ?? completed[completed.length - 1];
  if (!current?.result) return null;
  const r = current.result;
  const label = (k: string) => DEMO_RUBRIC.dimensions.find((d) => d.key === k)?.label ?? k;
  const jump = (turnId: string) => {
    setHighlight(turnId);
    document.getElementById(`fb-${turnId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const you = audience === 'rep' ? 'you' : 'the rep';

  return (
    <div className="stack">
      <div className="card feedback-hero">
        <div className="spread">
          <h2 style={{ margin: 0 }}>Feedback</h2>
          <span className={`tag ${current.evaluatorKind === 'anthropic' ? 'teal' : 'amber'}`}>{evaluatorLabel(current)}</span>
        </div>
        <p className="small muted" style={{ marginTop: '0.5rem' }}>
          Based on transcript revision {current.transcriptRevision} · rubric {r.rubric_version} · {fmtDate(current.createdAt)}.
          This is training feedback on the words in the transcript — not a compliance certificate or a decision about anyone’s work.
        </p>
        {completed.length > 1 && (
          <div className="field">
            <label htmlFor="rev">Feedback version</label>
            <select id="rev" value={current.id} onChange={(e) => setSelected(e.target.value)}>
              {completed.map((e) => <option key={e.id} value={e.id}>Revision {e.transcriptRevision} · {fmtDate(e.createdAt)}</option>)}
            </select>
          </div>
        )}
        <div className="grid two">
          <div className="card soft" style={{ marginBottom: 0 }}>
            <h3>Strength</h3>
            {r.strength ? <p>{r.strength.text} <TurnLinks ids={r.strength.turn_ids} onJump={jump} /></p> : <p className="muted">No supported strength observed in this exchange.</p>}
          </div>
          <div className="card soft" style={{ marginBottom: 0 }}>
            <h3>Priority improvement</h3>
            {r.improvement ? <p>{r.improvement.text} <TurnLinks ids={r.improvement.turn_ids} onJump={jump} /></p> : <p className="muted">No supported improvement observed.</p>}
          </div>
        </div>
        {(r.required_statements?.length ?? 0) > 0 && (
          <div className="card soft must-say" style={{ marginBottom: 0 }}>
            <h3>Must-say checklist</h3>
            <ul className="checklist">
              {r.required_statements!.map((q) => (
                <li key={q.id} className={q.said ? 'said' : 'missed'}>
                  <span aria-hidden="true">{q.said ? '✓' : '✗'}</span>
                  <span><span className="visually-hidden">{q.said ? 'Said: ' : 'Not said: '}</span>{mustSay.find((m) => m.id === q.id)?.text ?? q.id}
                    {q.said ? <> <TurnLinks ids={[...new Set(q.evidence.map((e) => e.turn_id))]} onJump={jump} /></> : <span className="small muted"> Not said in this conversation.</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {r.concerns.length > 0 && (
        <div className="card concerns-card">
          <h2>Flagged for manager review</h2>
          <p className="small muted">Coaching flags, not definitive judgements. A manager reviews each one.</p>
          {r.concerns.map((c, i) => (
            <div key={i} style={{ marginTop: '0.75rem' }}>
              <span className="tag red">{CONCERN_LABEL[c.type]}</span>
              <p style={{ marginTop: '0.4rem' }}>{c.explanation}{c.contradicted_fact_id ? ` (approved fact ${c.contradicted_fact_id})` : ''}</p>
              {c.evidence.map((e, j) => <Quote key={j} e={e} onJump={jump} />)}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>Rubric</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {r.dimensions.map((d) => (
            <li key={d.key} style={{ padding: '0.75rem 0', borderTop: '1px solid var(--line)' }}>
              <div className="spread"><strong>{label(d.key)}</strong><ScoreDots score={d.score} /></div>
              <p className="small" style={{ margin: '0.25rem 0' }}>{d.reason}</p>
              {d.evidence.map((e, j) => <Quote key={j} e={e} onJump={jump} />)}
            </li>
          ))}
        </ul>
        {r.limitations.length > 0 && (
          <details style={{ marginTop: '0.75rem' }}>
            <summary>Limitations of this feedback</summary>
            <ul className="small">{r.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </details>
        )}
      </div>

      <div className="card">
        <h2>Transcript used for this feedback</h2>
        <p className="small muted">Evidence links highlight the turn {you} said. Revision {current.transcriptRevision}{session.transcriptRevision !== current.transcriptRevision ? ` (latest is ${session.transcriptRevision})` : ''}.</p>
        <Transcript session={session} revision={current.transcriptRevision} highlight={highlight} idPrefix="fb" />
      </div>
    </div>
  );
}

function TurnLinks({ ids, onJump }: { ids: string[]; onJump: (id: string) => void }) {
  return <>{ids.map((id) => <button key={id} className="btn link small" onClick={() => onJump(id)}>[{id}]</button>)}</>;
}

function Quote({ e, onJump }: { e: { turn_id: string; quote: string }; onJump: (id: string) => void }) {
  return (
    <blockquote className="evidence">
      “{e.quote}” <button className="btn link small" onClick={() => onJump(e.turn_id)} aria-label={`Show ${e.turn_id} in transcript`}>{e.turn_id}</button>
    </blockquote>
  );
}
