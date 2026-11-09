import type { DimensionKey, PracticeSession } from './types.ts';
import { DIMENSION_KEYS } from './types.ts';

export const MIN_SAMPLE = 3;

export interface SessionSummary {
  id: string;
  repId: string;
  status: PracticeSession['status'];
  evaluationStatus: PracticeSession['evaluationStatus'];
  endedAt: string | null;
  usedSeconds: number | null;
  rubricVersion: string;
  /** Latest completed evaluation scores only; null = not observed. */
  scores: Partial<Record<DimensionKey, number | null>> | null;
  openConcerns: number;
  openReports: number;
}

export interface DimensionBreakdown {
  key: DimensionKey;
  observed: number;
  notObserved: number;
  mean: number | null;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  enoughData: boolean;
}

export interface ManagerOverview {
  periodDays: number;
  activeReps: number;
  repsWithCompleted: number;
  completedSessions: number;
  minutesUsed: number;
  openFlags: number;
  rubricVersion: string;
  breakdown: DimensionBreakdown[];
  excludedOtherRubric: { version: string; sessions: number }[];
  /** The last four 7-day windows, oldest first (independent of the chosen period). */
  trend: WeekTrend[];
}

export interface WeekTrend {
  /** 0 = the last 7 days, 1 = the 7 days before that, … */
  weeksAgo: number;
  sessions: number;
  reps: number;
  /** Mean of all observed scores on the current rubric; null when there are fewer than MIN_SAMPLE sessions. */
  mean: number | null;
}

export function computeTrend(opts: { sessions: SessionSummary[]; activeRepIds: string[]; now: Date; currentRubricVersion: string }): WeekTrend[] {
  const active = new Set(opts.activeRepIds);
  const out: WeekTrend[] = [];
  for (let w = 3; w >= 0; w--) {
    const to = opts.now.getTime() - w * 7 * 86400_000;
    const from = to - 7 * 86400_000;
    const inWeek = opts.sessions.filter((s) => s.endedAt && active.has(s.repId) && s.evaluationStatus === 'completed'
      && new Date(s.endedAt).getTime() > from && new Date(s.endedAt).getTime() <= to);
    const scores = inWeek.filter((s) => s.rubricVersion === opts.currentRubricVersion)
      .flatMap((s) => Object.values(s.scores ?? {}).filter((v): v is number => typeof v === 'number'));
    const scoredSessions = inWeek.filter((s) => s.rubricVersion === opts.currentRubricVersion).length;
    out.push({
      weeksAgo: w, sessions: inWeek.length, reps: new Set(inWeek.map((s) => s.repId)).size,
      mean: scoredSessions >= MIN_SAMPLE && scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
    });
  }
  return out;
}

/**
 * Participation denominator = active rep memberships at the time of viewing.
 * Dimension means use only observed (non-null) scores of completed evaluations for ONE rubric version.
 */
export function computeOverview(opts: {
  sessions: SessionSummary[];
  activeRepIds: string[];
  periodDays: number;
  now: Date;
  currentRubricVersion: string;
}): ManagerOverview {
  const since = opts.now.getTime() - opts.periodDays * 86400_000;
  const active = new Set(opts.activeRepIds);
  const inPeriod = opts.sessions.filter((s) => s.endedAt && new Date(s.endedAt).getTime() >= since && active.has(s.repId));
  const completed = inPeriod.filter((s) => s.evaluationStatus === 'completed');
  const current = completed.filter((s) => s.rubricVersion === opts.currentRubricVersion);
  const other = new Map<string, number>();
  for (const s of completed) if (s.rubricVersion !== opts.currentRubricVersion) other.set(s.rubricVersion, (other.get(s.rubricVersion) ?? 0) + 1);

  const breakdown = DIMENSION_KEYS.map((key): DimensionBreakdown => {
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
    let sum = 0, observed = 0, notObserved = 0;
    for (const s of current) {
      const v = s.scores?.[key];
      if (v === null || v === undefined) { notObserved++; continue; }
      distribution[v as 1 | 2 | 3 | 4 | 5]++; sum += v; observed++;
    }
    return { key, observed, notObserved, mean: observed ? Math.round((sum / observed) * 10) / 10 : null, distribution, enoughData: observed >= MIN_SAMPLE };
  });

  return {
    periodDays: opts.periodDays,
    activeReps: active.size,
    repsWithCompleted: new Set(completed.map((s) => s.repId)).size,
    completedSessions: completed.length,
    minutesUsed: Math.round((inPeriod.reduce((a, s) => a + (s.usedSeconds ?? 0), 0) / 60) * 10) / 10,
    openFlags: opts.sessions.filter((s) => active.has(s.repId)).reduce((a, s) => a + s.openConcerns + s.openReports, 0),
    rubricVersion: opts.currentRubricVersion,
    breakdown,
    excludedOtherRubric: [...other.entries()].map(([version, sessions]) => ({ version, sessions })),
    trend: computeTrend(opts),
  };
}

// ---------------- rep database (DECISIONS D25) ----------------

/** A session summary with what the rep database shows about it. */
export interface TeamSessionSummary extends SessionSummary {
  repName?: string;
  scenarioKey: string;
  scenarioTitle?: string;
  drillKey: string | null;
}

export interface RosterMemberBase { userId: string; name: string; email: string; role: 'manager' | 'rep'; active: boolean; sessions: number }

export interface RepDirectoryRow extends RosterMemberBase {
  completed: number;
  lastPracticeAt: string | null;
  openFlags: number;
  /** Mean of observed scores across all five dimensions (current rubric only); null if none. */
  meanScore: number | null;
  scoredSessions: number;
  /** Assigned scenario keys; empty = every active scenario. */
  assignedKeys: string[];
}

export interface RepProfile {
  member: RepDirectoryRow;
  sessions: TeamSessionSummary[];
  rubricVersion: string;
  minutesUsed: number;
  breakdown: DimensionBreakdown[];
}

/** Adds practice statistics and assignments to roster members (same rules as computeOverview). */
export function buildDirectory(opts: { members: RosterMemberBase[]; sessions: TeamSessionSummary[]; assignments: Record<string, string[]>; currentRubricVersion: string }): RepDirectoryRow[] {
  return opts.members.map((m) => {
    const mine = opts.sessions.filter((s) => s.repId === m.userId);
    const completed = mine.filter((s) => s.evaluationStatus === 'completed');
    const scored = completed.filter((s) => s.rubricVersion === opts.currentRubricVersion && s.scores);
    const values = scored.flatMap((s) => Object.values(s.scores!).filter((v): v is number => typeof v === 'number'));
    const last = mine.map((s) => s.endedAt).filter((x): x is string => !!x).sort().at(-1) ?? null;
    return {
      ...m,
      sessions: mine.length,
      completed: completed.length,
      lastPracticeAt: last,
      openFlags: mine.reduce((a, s) => a + s.openConcerns + s.openReports, 0),
      meanScore: values.length ? Math.round((values.reduce((a, v) => a + v, 0) / values.length) * 10) / 10 : null,
      scoredSessions: scored.length,
      assignedKeys: opts.assignments[m.userId] ?? [],
    };
  });
}

export function buildRepProfile(opts: { member: RosterMemberBase; sessions: TeamSessionSummary[]; assignments: Record<string, string[]>; currentRubricVersion: string; now: Date }): RepProfile {
  const [row] = buildDirectory({ members: [opts.member], sessions: opts.sessions, assignments: opts.assignments, currentRubricVersion: opts.currentRubricVersion });
  const mine = opts.sessions.filter((s) => s.repId === opts.member.userId).sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''));
  // All-time breakdown for this rep, one rubric version (never combined).
  const o = computeOverview({ sessions: mine, activeRepIds: [opts.member.userId], periodDays: 3650, now: opts.now, currentRubricVersion: opts.currentRubricVersion });
  return { member: row!, sessions: mine, rubricVersion: opts.currentRubricVersion, minutesUsed: o.minutesUsed, breakdown: o.breakdown };
}
