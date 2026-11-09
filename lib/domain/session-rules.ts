import type { DrillKey, ScenarioKey } from './types.ts';
import type { TranscriptTurn } from './transcript.ts';

/**
 * Application-layer rules applied before any resident model is called (build pack sections 5 and 9).
 * Firm refusal is deterministic: refusal opener → exactly one rep turn → end. Continued pitching is
 * flagged by evaluation, not argued by the resident.
 */
export function isBoundaryScenario(scenarioKey: ScenarioKey, drillKey: DrillKey | null): boolean {
  if (drillKey) return drillKey === 'asks-to-end' || drillKey === 'not-interested';
  return scenarioKey === 'firm-refusal';
}

export type ResidentDirective =
  | { kind: 'call_resident' }
  | { kind: 'end'; reason: 'boundary_final' | 'turn_limit' };

export function residentDirective(opts: {
  scenarioKey: ScenarioKey;
  drillKey: DrillKey | null;
  transcript: TranscriptTurn[];
  maxRepTurns: number;
}): ResidentDirective {
  const repCount = opts.transcript.filter((t) => t.speaker === 'rep').length;
  if (isBoundaryScenario(opts.scenarioKey, opts.drillKey) && repCount >= 1) return { kind: 'end', reason: 'boundary_final' };
  if (repCount >= opts.maxRepTurns) return { kind: 'end', reason: 'turn_limit' };
  return { kind: 'call_resident' };
}

/**
 * Elapsed seconds charged for a usable session: wall time from start, minus time the clock was paused
 * while the AI worked, capped at the session maximum.
 */
export function chargeableSeconds(startedAt: Date | null, endedAt: Date, maxSeconds: number, pausedSeconds = 0): number {
  if (!startedAt) return 0;
  const s = Math.ceil((endedAt.getTime() - startedAt.getTime()) / 1000) - pausedSeconds;
  return Math.max(0, Math.min(maxSeconds, s));
}
