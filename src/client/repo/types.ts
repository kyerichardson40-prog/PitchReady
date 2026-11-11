import type { PracticeMinutes } from '../../../lib/domain/limits.ts';
import type { SalesContext } from '../../../lib/domain/sales.ts';
import type { CampaignPack, MustSay, ObjectionAnswer, Drill, DrillKey, EvaluationResult, FeedbackReport, ManagerReview, PracticeSession, RubricVersion, Scenario, ScenarioKey } from '../../../lib/domain/types.ts';
import type { TranscriptTurn } from '../../../lib/domain/transcript.ts';
import type { ManagerOverview, RepDirectoryRow, RepProfile } from '../../../lib/domain/metrics.ts';

export interface AppContextData {
  mode: 'demo' | 'connected';
  user: { id: string; name: string; email: string; role: 'manager' | 'rep' } | null;
  membershipActive: boolean;
  agencyName: string | null;
  campaign: {
    version: number; name: string; fictional: boolean; organisation: string; facts: { id: string; text: string }[];
    /** The agency's say rules (published version). */
    mustSay: MustSay[]; neverSay: string[]; forbiddenClaims: string[]; objectionAnswers: ObjectionAnswer[];
    salesContext: SalesContext;
    /** Full practice session length chosen by the manager (3, 5 or 10). */
    practiceMinutes: PracticeMinutes;
  } | null;
  rubricVersion: string | null;
  scenarios: Scenario[];
  usage: { allowanceSeconds: number; consumedSeconds: number; reservedSeconds: number; periodEnd: string | null } | null;
  retentionDays: number | null;
  /** Manager emails (flagged sessions, weekly summary) on or off for the team. */
  emailNotifications?: boolean | null;
  /** Signed in and belongs to a team. */
  hasTeam?: boolean;
  /** Signed in, no team yet, and free pilots are open. */
  canStartPilot?: boolean;
  emailConfirmed?: boolean;
  /** Free pilots can be started by anyone who signs up (connected mode). */
  pilotsOpen?: boolean;
  /** Size of a free pilot (owner setting). */
  pilot?: { minutes: number; days: number };
  /** Signed in as the site owner (OWNER_EMAILS). */
  isOwner?: boolean;
  /** Site-wide message from the owner. */
  announcement?: { text: string; tone: 'info' | 'warn' } | null;
  /** First-time questions: done (answered or skipped), and the answers. */
  onboarding?: { done: boolean; skipped?: boolean; role?: 'rep' | 'manager' | null; struggles?: string[]; goals?: string[] };
  /** Set when the owner has paused practice: the message to show. */
  practicePaused?: string | null;
  voice: { stt: boolean; tts: boolean; deviceVoice: boolean };
  liveAi: boolean;
  demoPeople?: { id: string; name: string; email: string; role: 'manager' | 'rep'; active: boolean }[];
}

export interface TurnResult {
  session: PracticeSession;
  residentAudio: { base64: string; mimeType: string } | null;
  notices: string[];
}

export interface RosterData {
  /** The rep database: every member with practice statistics and scenario assignments. */
  members: RepDirectoryRow[];
  invitations: { id: string; email: string; role: 'manager' | 'rep'; createdAt: string; expiresAt: string; usedAt: string | null; revokedAt: string | null }[];
  seatLimit: number;
}

export interface TeamSessionRow {
  id: string; repName: string; scenarioKey: ScenarioKey; scenarioTitle?: string; drillKey: DrillKey | null; endedAt: string | null;
  status: PracticeSession['status']; evaluationStatus: PracticeSession['evaluationStatus']; openConcerns: number; openReports: number;
}

export interface CampaignAdmin {
  published: { version: number; pack: CampaignPack; rubric: RubricVersion; publishedAt: string; approvedBy: string }[];
  draft: { pack: CampaignPack; rubric: RubricVersion; updatedAt: string } | null;
}

export interface ScenarioAdmin {
  /** Latest version of every scenario, archived ones included. */
  scenarios: (Scenario & { archived?: boolean })[];
  /** Assigned scenario keys per rep (user id). Reps without an entry see every active scenario. */
  assignments: Record<string, string[]>;
}
export interface ContactInput { name: string; email: string; company: string; team_size: string; sales_type: string; message: string; website: string }
export interface ScenarioFields { title: string; persona: string; opener: string; objection: string; goal: string; allowedEnding: string; behaviour: string; skill: string }

export interface Repository {
  readonly mode: 'demo' | 'connected';
  getContext(): Promise<AppContextData>;
  listMySessions(): Promise<PracticeSession[]>;
  startSession(input: { scenarioKey: ScenarioKey; drillKey: DrillKey | null; parentSessionId: string | null; idempotencyKey: string }): Promise<TurnResult>;
  submitTypedTurn(id: string, input: { text: string; expectedSequence: number; idempotencyKey: string }): Promise<TurnResult>;
  submitAudioTurn(id: string, audio: Blob, meta: { expectedSequence: number; idempotencyKey: string; durationMs: number }): Promise<TurnResult>;
  endSession(id: string, input: { idempotencyKey: string }): Promise<PracticeSession>;
  getSession(id: string): Promise<{ session: PracticeSession; reports: FeedbackReport[]; reviews: ManagerReview[] }>;
  retryEvaluation(id: string): Promise<PracticeSession>;
  reportFeedback(id: string, input: { reason: FeedbackReport['reason']; description: string; turnId?: string | null }): Promise<void>;
  requestDeletion(input: { scope: 'my_transcripts' | 'my_account'; note?: string }): Promise<void>;
  // manager
  getOverview(periodDays: number): Promise<ManagerOverview & { remainingSeconds: number; allowanceSeconds: number }>;
  listTeamSessions(): Promise<TeamSessionRow[]>;
  getRoster(): Promise<RosterData>;
  createInvitation(input: { email: string; role: 'rep' | 'manager' }): Promise<{ link: string; expiresAt: string; emailed?: boolean }>;
  updateName(name: string): Promise<void>;
  updateTeamSettings(input: { retentionDays?: number; emailNotifications?: boolean }): Promise<void>;
  revokeInvitation(id: string): Promise<void>;
  setMemberActive(userId: string, active: boolean): Promise<void>;
  addReview(sessionId: string, input: { note: string; resolution: ManagerReview['resolution']; reportId?: string | null }): Promise<void>;
  addCorrection(sessionId: string, input: { turnId: string; correctedText: string; note?: string; idempotencyKey: string }): Promise<void>;
  getCampaignAdmin(): Promise<CampaignAdmin>;
  saveDraft(pack: CampaignPack, rubric: RubricVersion): Promise<void>;
  publishDraft(): Promise<{ version: number }>;
  getScenarioAdmin(): Promise<ScenarioAdmin>;
  /** No key = new scenario. Each save of an existing one is a new version. */
  saveScenario(input: ScenarioFields & { key?: string | null }): Promise<{ key: string; version: number }>;
  /** Public contact form. The demo does not send anything. */
  sendContact(input: ContactInput): Promise<void>;
  setScenarioArchived(key: string, archived: boolean): Promise<void>;
  setScenarioAssignments(userId: string, keys: string[]): Promise<void>;
  getRepProfile(userId: string): Promise<RepProfile>;
  // demo only
  demoReset?(): Promise<void>;
  demoSwitchUser?(userId: string): Promise<void>;
  /** Simulated sign-in / sign-out (demo only). */
  demoSignIn?(userId: string): Promise<void>;
  demoSignOut?(): Promise<void>;
  /** Standalone demo only, when the page can ask Claude: the live-AI switch (DECISIONS D24). */
  liveAi?: LiveAiControl;
  /** Standalone demo only, when Claude can't be reached in this view: why, for the demo banner. */
  readonly liveAiNote?: string;
}

export interface LiveAiControl {
  readonly enabled: boolean;
  /** Why the last live call failed, in viewer-facing words; null if it didn't. */
  readonly lastError: string | null;
  setEnabled(enabled: boolean): void;
}

/**
 * Live resident + evaluator for the standalone demo (implemented in src/static-demo/live-ai.ts).
 * Calls reject on failure; the demo repository then falls back or leaves feedback pending.
 */
export interface LiveAiEngine {
  /** Shown as the evaluation's model, e.g. "Claude via claude.ai (preview)". */
  readonly label: string;
  readonly promptVersion: string;
  residentReply(input: { scenario: Scenario; drill: Drill | null; campaign: CampaignPack; transcript: TranscriptTurn[]; repliesLeft?: number }): Promise<{ utterance: string; endConversation: boolean }>;
  /** Validated with validateEvaluation, with one repair attempt. */
  evaluate(input: { scenario: Scenario; drill: Drill | null; campaign: CampaignPack; rubric: RubricVersion; transcript: TranscriptTurn[]; transcriptRevision: number }): Promise<{ ok: true; result: EvaluationResult } | { ok: false; errors: string[] }>;
}

export class RepoError extends Error {
  code: string; requestId?: string; status?: number;
  constructor(code: string, message: string, requestId?: string, status?: number) {
    super(message); this.code = code; this.requestId = requestId; this.status = status;
  }
}
