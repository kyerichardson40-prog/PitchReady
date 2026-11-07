import type { ReactNode } from 'react';
import { getDrill, getScenario } from '../../../lib/content/scenarios.ts';
import type { DrillKey, PracticeSession, ScenarioKey } from '../../../lib/domain/types.ts';

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <p role="status" aria-live="polite" className="muted">{label}</p>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="alert error" role="alert">
      <p className="m0">{message}</p>
      {onRetry && <button className="btn mt-sm" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card soft"><p className="muted m0">{children}</p></div>;
}

export function ScoreDots({ score }: { score: number | null }) {
  if (score === null) return <span className="tag">Not observed</span>;
  return (
    <span className="score" aria-label={`Score ${score} out of 5`}>
      <span className="dots" aria-hidden="true">{[1, 2, 3, 4, 5].map((i) => <span key={i} className={`dot ${i <= score ? 'on' : ''}`} />)}</span>
      <strong>{score}/5</strong>
    </span>
  );
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function fmtMinutes(seconds: number): string {
  return `${Math.floor(seconds / 60)} min${seconds % 60 ? ` ${seconds % 60}s` : ''}`;
}

export function sessionTitle(s: { scenarioKey: ScenarioKey; scenarioTitle?: string; drillKey: DrillKey | null }): string {
  if (s.drillKey) return `Drill: ${getDrill(s.drillKey)?.title ?? s.drillKey}`;
  return s.scenarioTitle ?? getScenario(s.scenarioKey)?.title ?? s.scenarioKey;
}

export function StatusTag({ s }: { s: Pick<PracticeSession, 'status' | 'evaluationStatus'> }) {
  if (s.status === 'active') return <span className="tag teal">In progress</span>;
  if (s.status === 'failed') return <span className="tag red">Failed</span>;
  if (s.status === 'abandoned') return <span className="tag amber">Abandoned</span>;
  switch (s.evaluationStatus) {
    case 'completed': return <span className="tag teal">Feedback ready</span>;
    case 'pending': case 'running': return <span className="tag amber">Feedback pending</span>;
    case 'unavailable': return <span className="tag red">Feedback unavailable</span>;
    default: return <span className="tag">Ended</span>;
  }
}

export function FictionalTag() {
  return <span className="tag amber">Fictional demo campaign</span>;
}
