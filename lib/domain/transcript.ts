import type { Speaker, Turn, TurnCorrection } from './types.ts';

export interface TranscriptTurn { id: string; speaker: Speaker; text: string; corrected: boolean }

/** Stable label for the n-th turn of a speaker, e.g. rep-2. */
export function turnLabel(speaker: Speaker, turns: Pick<Turn, 'speaker'>[]): string {
  return `${speaker}-${turns.filter((t) => t.speaker === speaker).length + 1}`;
}

/**
 * Builds the transcript for a given revision. Original turns are immutable; revision N applies
 * every correction with revision <= N (latest correction per turn wins).
 */
export function transcriptAtRevision(turns: Turn[], corrections: TurnCorrection[], revision: number): TranscriptTurn[] {
  const applicable = corrections.filter((c) => c.revision <= revision).sort((a, b) => a.revision - b.revision);
  const latest = new Map<string, TurnCorrection>();
  for (const c of applicable) latest.set(c.turnId, c);
  return [...turns].sort((a, b) => a.sequence - b.sequence).map((t) => {
    const c = latest.get(t.id);
    return { id: t.id, speaker: t.speaker, text: c ? c.correctedText : t.text, corrected: Boolean(c) };
  });
}

export function repTurns(t: TranscriptTurn[]): TranscriptTurn[] {
  return t.filter((x) => x.speaker === 'rep');
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
