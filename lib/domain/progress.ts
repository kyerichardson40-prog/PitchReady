import { DIMENSION_KEYS, type DimensionKey, type PracticeSession } from './types.ts';

/**
 * A rep's own progress, worked out from the sessions they can already see. Scores are the mean of
 * the observed rubric scores (1–5) in a session's latest feedback; "not observed" is never counted
 * as zero. Only as far back as the team's retention period, because older sessions are deleted.
 */
export interface RepProgress {
  sessions: number;
  scored: number;
  /** Mean of the most recent scored sessions (up to 5). */
  average: number | null;
  /** Mean of the 5 scored sessions before those, when there are at least 2. */
  previousAverage: number | null;
  best: { id: string; score: number; title: string } | null;
  /** Days in a row with at least one finished practice, counting today or yesterday as the latest. */
  streakDays: number;
  practisedToday: boolean;
  skills: { key: DimensionKey; average: number | null; previous: number | null }[];
  /** Oldest → newest, at most 12, for the small chart. */
  recent: { id: string; score: number }[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function latestResult(s: PracticeSession) {
  return [...s.evaluations].filter((e) => e.status === 'completed' && e.result)
    .sort((a, b) => b.transcriptRevision - a.transcriptRevision || b.createdAt.localeCompare(a.createdAt))[0]?.result ?? null;
}

export function sessionScore(s: PracticeSession): number | null {
  const scores = (latestResult(s)?.dimensions ?? []).map((d) => d.score).filter((x): x is 1 | 2 | 3 | 4 | 5 => typeof x === 'number');
  const m = mean(scores);
  return m === null ? null : round1(m);
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

export function computeProgress(all: PracticeSession[], now = new Date(), title: (s: PracticeSession) => string = (s) => s.scenarioTitle ?? s.scenarioKey): RepProgress {
  const done = all.filter((s) => s.status === 'ended' && s.endedAt).sort((a, b) => a.endedAt!.localeCompare(b.endedAt!));
  const scored = done.map((s) => ({ s, score: sessionScore(s) })).filter((x): x is { s: PracticeSession; score: number } => x.score !== null);
  const last = scored.slice(-5);
  const before = scored.slice(-10, -5);

  const days = new Set(done.map((s) => dayKey(new Date(s.endedAt!))));
  const practisedToday = days.has(dayKey(now));
  let streak = 0;
  const cursor = new Date(now);
  if (!practisedToday) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dayKey(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }

  const skillMean = (items: { s: PracticeSession }[], key: DimensionKey) => {
    const m = mean(items.map(({ s }) => latestResult(s)?.dimensions.find((d) => d.key === key)?.score).filter((x): x is 1 | 2 | 3 | 4 | 5 => typeof x === 'number'));
    return m === null ? null : round1(m);
  };
  const bestEntry = scored.reduce<{ s: PracticeSession; score: number } | null>((b, x) => (!b || x.score >= b.score ? x : b), null);

  const avg = mean(last.map((x) => x.score));
  const prev = before.length >= 2 ? mean(before.map((x) => x.score)) : null;
  return {
    sessions: done.length, scored: scored.length,
    average: avg === null ? null : round1(avg),
    previousAverage: prev === null ? null : round1(prev),
    best: bestEntry ? { id: bestEntry.s.id, score: bestEntry.score, title: title(bestEntry.s) } : null,
    streakDays: streak, practisedToday,
    skills: DIMENSION_KEYS.map((key) => ({ key, average: skillMean(last, key), previous: before.length >= 2 ? skillMean(before, key) : null })),
    recent: scored.slice(-12).map((x) => ({ id: x.s.id, score: x.score })),
  };
}
