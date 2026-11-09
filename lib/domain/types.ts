import type { SalesContext } from './sales.ts';
import type { SessionKind } from './limits.ts';

export const DIMENSION_KEYS = ['introduction', 'accuracy', 'listening', 'next_step', 'respect'] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];

export const CONCERN_TYPES = ['unsupported_campaign_claim', 'ignored_stop_request', 'misstated_commitment', 'banned_phrase', 'other_review_needed'] as const;
export type ConcernType = (typeof CONCERN_TYPES)[number];

/** The five scenarios from the build pack. Agencies can add their own (any slug), so ScenarioKey is a string. */
export const SCENARIO_KEYS = ['busy', 'existing-donor', 'sceptical', 'monthly-giving', 'firm-refusal'] as const;
export type BuiltInScenarioKey = (typeof SCENARIO_KEYS)[number];
export type ScenarioKey = string;
export const SCENARIO_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;

export const DRILL_KEYS = [
  'already-donate', 'busy', 'not-interested', 'cannot-afford', 'prefers-one-off',
  'legitimacy', 'amount', 'money-use', 'cancellation', 'asks-to-end',
] as const;
export type DrillKey = (typeof DRILL_KEYS)[number];

export type Speaker = 'resident' | 'rep';
export type TurnSource = 'typed' | 'transcribed' | 'scripted' | 'generated';

/** Turn labels such as "resident-1" / "rep-2" are the stable IDs used by evaluation evidence. */
export interface Turn {
  id: string;
  sequence: number;
  speaker: Speaker;
  text: string;
  source: TurnSource;
  createdAt: string;
}

export interface TurnCorrection {
  turnId: string;
  revision: number;
  correctedText: string;
  correctedBy: string;
  createdAt: string;
  note?: string;
}

export interface ApprovedFact { id: string; text: string }
/** Something reps must say. `cues` are example wordings: used by the demo rules and given to the AI as hints. */
export interface MustSay { id: string; text: string; cues: string[] }
export interface ObjectionAnswer { objection: string; answer: string }

export interface CampaignPack {
  campaign_key: string;
  version: number;
  name: string;
  fictional: boolean;
  organisation: string;
  approved_facts: ApprovedFact[];
  forbidden_claims: string[];
  /** Statements every conversation should include (checked in feedback). */
  must_say: MustSay[];
  /** Words and phrases reps must never use (flagged in feedback). */
  never_say: string[];
  /** Approved answers to common objections (coaching examples). */
  objection_answers: ObjectionAnswer[];
  sample_opening: string;
  sample_explanation: string;
  sample_unknown_answer: string;
  sample_disengagement: string;
  /** Where and what the team sells. Missing on packs from before it existed (door-to-door fundraising). */
  sales_context?: SalesContext;
}

export interface Scenario {
  key: ScenarioKey;
  version: number;
  title: string;
  persona: string;
  opener: string;
  objection: string;
  goal: string;
  allowedEnding: string;
  behaviour: string;
  skill: string;
  /** Archived scenarios stay on old sessions but can't be started. */
  archived?: boolean;
}

export interface Drill {
  key: DrillKey;
  title: string;
  baseScenario: BuiltInScenarioKey;
  opener: string;
  objective: string;
}

export interface RubricAnchor { score: 1 | 2 | 3 | 4 | 5; description: string }
export interface RubricDimension { key: DimensionKey; label: string; anchors: RubricAnchor[]; improvementTip: string }
export interface RubricVersion {
  version: string;
  promptVersion: string;
  dimensions: RubricDimension[];
  approvedBy: string | null;
  approvedAt: string | null;
}

export interface Evidence { turn_id: string; quote: string }
export interface DimensionResult { key: DimensionKey; score: 1 | 2 | 3 | 4 | 5 | null; reason: string; evidence: Evidence[] }
export interface Concern { type: ConcernType; explanation: string; evidence: Evidence[]; contradicted_fact_id: string | null }
/** One per must-say item: whether the rep said it, with exact quotes when they did. */
export interface RequiredStatementResult { id: string; said: boolean; evidence: Evidence[] }
export interface EvaluationResult {
  /** 1.1 adds required_statements; stored 1.0 results have none. */
  schema_version: '1.0' | '1.1';
  rubric_version: string;
  transcript_revision: number;
  dimensions: DimensionResult[];
  strength: { text: string; turn_ids: string[] } | null;
  improvement: { text: string; turn_ids: string[] } | null;
  concerns: Concern[];
  required_statements?: RequiredStatementResult[];
  retry: { objective: string; scenario_key: ScenarioKey; drill_key: DrillKey | null; max_seconds: number };
  limitations: string[];
}

export type SessionStatus = 'created' | 'active' | 'ending' | 'ended' | 'failed' | 'abandoned';
export type EvaluationStatus = 'none' | 'pending' | 'running' | 'completed' | 'unavailable';
export type EndReason =
  | 'rep_ended' | 'resident_ended' | 'time_limit' | 'turn_limit' | 'provider_failure'
  | 'abandoned' | 'membership_revoked';

export interface EvaluationRecord {
  id: string;
  transcriptRevision: number;
  evaluatorKind: 'demo' | 'mock' | 'anthropic';
  model: string | null;
  promptVersion: string;
  status: 'completed' | 'unavailable';
  result: EvaluationResult | null;
  createdAt: string;
  errors?: string[];
}

export interface PracticeSession {
  id: string;
  repId: string;
  repName: string;
  kind: SessionKind;
  scenarioKey: ScenarioKey;
  /** Title of the scenario version used (agency-written scenarios aren't in app code). */
  scenarioTitle?: string;
  drillKey: DrillKey | null;
  parentSessionId: string | null;
  campaignVersion: number;
  campaignName: string;
  rubricVersion: string;
  mode: 'demo' | 'connected';
  status: SessionStatus;
  evaluationStatus: EvaluationStatus;
  startedAt: string | null;
  deadlineAt: string | null;
  endedAt: string | null;
  endReason: EndReason | null;
  transcriptRevision: number;
  turns: Turn[];
  corrections: TurnCorrection[];
  evaluations: EvaluationRecord[];
  usedSeconds: number | null;
}

export interface FeedbackReport {
  id: string;
  sessionId: string;
  reporterId: string;
  reason: 'transcription_error' | 'feedback_incorrect' | 'other';
  description: string;
  status: 'open' | 'resolved' | 'dismissed';
  createdAt: string;
}

export interface ManagerReview {
  id: string;
  sessionId: string;
  managerId: string;
  managerName: string;
  note: string;
  resolution: 'noted' | 'coaching_planned' | 'feedback_disputed' | 'resolved';
  createdAt: string;
}
