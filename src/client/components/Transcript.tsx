import { transcriptAtRevision } from '../../../lib/domain/transcript.ts';
import type { PracticeSession } from '../../../lib/domain/types.ts';

export function Transcript({ session, revision, highlight, idPrefix = 'turn' }: { session: PracticeSession; revision?: number; highlight?: string | null; idPrefix?: string }) {
  const rev = revision ?? session.transcriptRevision;
  const turns = transcriptAtRevision(session.turns, session.corrections, rev);
  if (!turns.length) return <p className="muted">No turns yet.</p>;
  return (
    <ol className="transcript" aria-label={`Transcript, revision ${rev}`}>
      {turns.map((t) => (
        <li key={t.id} id={`${idPrefix}-${t.id}`} className={`bubble ${t.speaker} ${highlight === t.id ? 'highlight' : ''}`}>
          <span className="who">{t.speaker === 'rep' ? 'You (rep)' : 'Resident'} · {t.id}{t.corrected ? ' · corrected' : ''}</span>
          {/* Rendered as text — React escapes transcript content. */}
          {t.text}
        </li>
      ))}
    </ol>
  );
}
