/**
 * Demo-mode engine. Browser-local, synthetic, deterministic. It mirrors the connected rules
 * (limits, idempotency, sequence checks, firm-refusal handling, allowance reservation) so the demo
 * behaves like the real product, but it is NOT a security boundary — everything runs in the browser.
 */
import { FICTIONAL_CAMPAIGN } from '../content/campaign.ts';
import { DEMO_RUBRIC } from '../content/rubric.ts';
import { getDrill, getScenario, scenarioForDrill, SCENARIOS } from '../content/scenarios.ts';
import { validateEvaluation, validationContext } from '../domain/evaluation-validator.ts';
import { sessionLimits } from '../domain/limits.ts';
import { buildDirectory, buildRepProfile, computeOverview, type RepDirectoryRow, type RepProfile, type TeamSessionSummary } from '../domain/metrics.ts';
import { chargeableSeconds, residentDirective } from '../domain/session-rules.ts';
import { transcriptAtRevision, turnLabel } from '../domain/transcript.ts';
import type {
  CampaignPack, DrillKey, EndReason, EvaluationResult, FeedbackReport, ManagerReview, PracticeSession, RubricVersion, Scenario, ScenarioKey, Turn,
} from '../domain/types.ts';
import { DEMO_EVALUATOR_VERSION, demoEvaluate } from './evaluator.ts';
import { demoResidentReply } from './resident.ts';

export const DEMO_STATE_VERSION = 4;

export interface DemoPerson { id: string; name: string; role: 'manager' | 'rep'; email: string; active: boolean }
export interface DemoInvitation { id: string; email: string; role: 'manager' | 'rep'; createdAt: string; expiresAt: string; usedAt: string | null; revokedAt: string | null }
export interface PublishedVersion { version: number; pack: CampaignPack; rubric: RubricVersion; publishedAt: string; approvedBy: string }
export interface DemoState {
  stateVersion: number;
  seededAt: string;
  agency: { id: string; name: string; retentionDays: number };
  people: DemoPerson[];
  currentUserId: string;
  /** Simulated sign-in: the demo opens on the role picker until someone signs in. */
  signedIn: boolean;
  /** Latest version of every scenario (built-in and agency-written), archived ones included. */
  scenarios: Scenario[];
  /** Scenario keys assigned per rep. A rep with none sees every active scenario. */
  assignments: Record<string, string[]>;
  invitations: DemoInvitation[];
  campaign: { published: PublishedVersion[]; draft: { pack: CampaignPack; rubric: RubricVersion; updatedAt: string } | null };
  sessions: PracticeSession[];
  reports: FeedbackReport[];
  reviews: ManagerReview[];
  usage: { periodStart: string; periodEnd: string; allowanceSeconds: number; consumedSeconds: number; reservedSeconds: number };
  ledger: { operationId: string; sessionId: string; kind: 'reservation' | 'settlement' | 'release'; seconds: number; at: string }[];
  deletionRequests: { id: string; userId: string; scope: string; requestedAt: string; status: 'requested' }[];
  idempotency: Record<string, string>;
}

export class DemoError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

let counter = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const iso = (d: Date) => d.toISOString();

export function currentPublished(s: DemoState): PublishedVersion {
  return s.campaign.published[s.campaign.published.length - 1]!;
}
export function currentUser(s: DemoState): DemoPerson {
  return s.people.find((p) => p.id === s.currentUserId)!;
}

// ---------------- seed ----------------
export function createSeedState(now = new Date()): DemoState {
  const ago = (mins: number) => new Date(now.getTime() - mins * 60_000);
  const published: PublishedVersion = { version: 1, pack: FICTIONAL_CAMPAIGN, rubric: DEMO_RUBRIC, publishedAt: iso(ago(60 * 24 * 5)), approvedBy: 'Riley (demo manager)' };
  const s: DemoState = {
    stateVersion: DEMO_STATE_VERSION,
    seededAt: iso(now),
    agency: { id: 'demo-agency', name: 'Demo Agency (fictional)', retentionDays: 30 },
    people: [
      { id: 'demo-manager', name: 'Riley (demo manager)', role: 'manager', email: 'riley@demo.invalid', active: true },
      { id: 'demo-rep-sam', name: 'Sam (demo rep)', role: 'rep', email: 'sam@demo.invalid', active: true },
      { id: 'demo-rep-priya', name: 'Priya (demo rep)', role: 'rep', email: 'priya@demo.invalid', active: true },
      { id: 'demo-rep-tom', name: 'Tom (demo rep)', role: 'rep', email: 'tom@demo.invalid', active: true },
      { id: 'demo-rep-aisha', name: 'Aisha (demo rep)', role: 'rep', email: 'aisha@demo.invalid', active: true },
      { id: 'demo-rep-dev', name: 'Dev (demo rep)', role: 'rep', email: 'dev@demo.invalid', active: true }, // deactivated after seeding
    ],
    currentUserId: 'demo-rep-sam',
    signedIn: false,
    scenarios: [...SCENARIOS.map((x) => ({ ...x, archived: false })), {
      key: 'new-neighbour', version: 1, title: 'New to the street', persona: 'Morgan, just moved in',
      opener: "We've only just moved in, there are boxes everywhere. What's this about?",
      objection: 'Wants to settle in first', goal: 'Introduce yourself and the campaign in a sentence or two, and respect that they are busy unpacking.',
      allowedEnding: 'A short explanation and a courteous goodbye.', behaviour: 'Friendly but distracted; open to a brief explanation; ends politely if pressured.',
      skill: 'Rapport and brevity', archived: false,
    }],
    assignments: { 'demo-rep-tom': ['busy', 'existing-donor', 'new-neighbour'] },
    invitations: [{ id: 'inv-demo-1', email: 'new.starter@demo.invalid', role: 'rep', createdAt: iso(ago(60 * 20)), expiresAt: iso(new Date(now.getTime() + 6 * 86400_000)), usedAt: null, revokedAt: null }],
    campaign: { published: [published], draft: null },
    sessions: [], reports: [], reviews: [],
    usage: { periodStart: iso(ago(60 * 24 * 5)), periodEnd: iso(new Date(now.getTime() + 9 * 86400_000)), allowanceSeconds: 9000, consumedSeconds: 0, reservedSeconds: 0 },
    ledger: [], deletionRequests: [], idempotency: {},
  };

  const history: { rep: string; scenario: ScenarioKey; minsAgo: number; lines: string[]; evaluate: boolean }[] = [
    { rep: 'demo-rep-sam', scenario: 'busy', minsAgo: 60 * 50, evaluate: true, lines: [
      "Hi, I'm Sam, practising on behalf of the fictional Neighbourhood Meal Project. Have you got a moment?",
      "Thanks. It's an optional £10 monthly gift to support community meal sessions, and it's completely fine to say no.",
    ] },
    { rep: 'demo-rep-sam', scenario: 'sceptical', minsAgo: 60 * 26, evaluate: true, lines: [
      "I'm Sam from the fictional Neighbourhood Meal Project, and I understand the question.",
      'Our registration number is 1234567 and one hundred percent of every donation goes straight to the people who need it.',
    ] },
    { rep: 'demo-rep-priya', scenario: 'firm-refusal', minsAgo: 60 * 30, evaluate: true, lines: ["Of course. Thanks for your time; I'll leave you to it."] },
    { rep: 'demo-rep-priya', scenario: 'existing-donor', minsAgo: 60 * 8, evaluate: true, lines: [
      "That's great that you already give. I'm Priya with the fictional Neighbourhood Meal Project.",
      'It supports community meal sessions locally. If you want, I can explain the optional £10 monthly gift, but no pressure at all.',
    ] },
    { rep: 'demo-rep-tom', scenario: 'busy', minsAgo: 60 * 70, evaluate: true, lines: [
      "Hi there, I'm Tom from the fictional Neighbourhood Meal Project. You won't even miss it, it's only £10 a month.",
    ] },
    { rep: 'demo-rep-tom', scenario: 'new-neighbour', minsAgo: 60 * 20, evaluate: true, lines: [
      "Welcome to the street! I'm Tom from the fictional Neighbourhood Meal Project, I'll be quick.",
      "We support community meal sessions nearby. It's completely voluntary, so no pressure at all. Good luck with the unpacking!",
    ] },
    { rep: 'demo-rep-aisha', scenario: 'existing-donor', minsAgo: 60 * 44, evaluate: true, lines: [
      "That's lovely that you already give. I'm Aisha, here on behalf of the fictional Neighbourhood Meal Project.",
      "We fund community meal sessions. It's an optional £10 monthly gift and it's fine to say no. Would you like to hear more?",
    ] },
    { rep: 'demo-rep-aisha', scenario: 'firm-refusal', minsAgo: 60 * 3, evaluate: true, lines: ['No problem at all, thanks for your time. Have a good evening.'] },
    { rep: 'demo-rep-dev', scenario: 'sceptical', minsAgo: 60 * 24 * 4, evaluate: true, lines: [
      "I'm Dev from the fictional Neighbourhood Meal Project. I don't have the registration details with me, so I'd need to check rather than guess.",
    ] },
    { rep: 'demo-rep-sam', scenario: 'monthly-giving', minsAgo: 35, evaluate: false, lines: [
      "Good question. I'm Sam from the fictional Neighbourhood Meal Project; it's an optional £10 monthly gift.",
      "I don't have approved information on cancelling, so I'd need to check rather than guess.",
    ] },
  ];
  for (const h of history) {
    const started = ago(h.minsAgo);
    const userBefore = s.currentUserId;
    s.currentUserId = h.rep;
    const session = startSession(s, { scenarioKey: h.scenario, drillKey: null, parentSessionId: null, idempotencyKey: uid('seed') }, started);
    let t = started.getTime();
    for (const line of h.lines) {
      if (session.status !== 'active') break;
      t += 20_000;
      submitTurn(s, session.id, { text: line, expectedSequence: session.turns.length + 1, idempotencyKey: uid('seed') }, new Date(t));
    }
    const live = getSessionRaw(s, session.id);
    if (live.status === 'active') endSession(s, session.id, { idempotencyKey: uid('seed') }, new Date(t + 10_000), 'rep_ended', h.evaluate);
    else if (!h.evaluate) { live.evaluationStatus = 'pending'; live.evaluations = []; }
    s.currentUserId = userBefore;
  }
  s.currentUserId = 'demo-rep-sam';
  s.people.find((p) => p.id === 'demo-rep-dev')!.active = false; // a former rep: history kept, access removed
  return s;
}

// ---------------- scenarios ----------------
/** Latest version of a scenario: the agency's copy, else built-in content (drills of an archived base). */
export function findScenario(s: DemoState, key: string): Scenario | undefined {
  return s.scenarios.find((x) => x.key === key) ?? getScenario(key);
}
/** Scenarios a rep may start: their assigned ones if any are set, otherwise every active scenario. */
export function allowedScenarios(s: DemoState, userId: string): Scenario[] {
  const assigned = s.assignments[userId];
  return s.scenarios.filter((x) => !x.archived && (!assigned?.length || assigned.includes(x.key)));
}

export interface ScenarioInput { key?: string | null; title: string; persona: string; opener: string; objection: string; goal: string; allowedEnding: string; behaviour: string; skill: string }

export function saveScenario(s: DemoState, input: ScenarioInput): { key: string; version: number } {
  requireManager(s);
  const fields = { title: input.title.trim(), persona: input.persona.trim(), opener: input.opener.trim(), objection: input.objection.trim(), goal: input.goal.trim(), allowedEnding: input.allowedEnding.trim(), behaviour: input.behaviour.trim(), skill: input.skill.trim() };
  if (Object.values(fields).some((v) => !v)) throw new DemoError('invalid_scenario', 'Every scenario field needs text.');
  if (input.key) {
    const i = s.scenarios.findIndex((x) => x.key === input.key);
    if (i < 0) throw new DemoError('not_found', 'Scenario not found.');
    const cur = s.scenarios[i]!;
    s.scenarios[i] = { ...cur, ...fields, version: cur.version + 1 }; // sessions keep their own title copy
    return { key: cur.key, version: cur.version + 1 };
  }
  const base = fields.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 34) || 'scenario';
  let key = base.length >= 2 ? base : 'scenario';
  for (let n = 2; s.scenarios.some((x) => x.key === key) || getScenario(key); n++) key = `${base}-${n}`;
  s.scenarios.push({ key, version: 1, ...fields, archived: false });
  return { key, version: 1 };
}

export function setScenarioArchived(s: DemoState, key: string, archived: boolean) {
  requireManager(s);
  const x = s.scenarios.find((v) => v.key === key);
  if (!x) throw new DemoError('not_found', 'Scenario not found.');
  if (x.archived === archived) return;
  x.archived = archived;
  x.version += 1;
  if (archived) for (const id of Object.keys(s.assignments)) s.assignments[id] = s.assignments[id]!.filter((k) => k !== key);
}

export function setAssignments(s: DemoState, userId: string, keys: string[]) {
  requireManager(s);
  const p = s.people.find((x) => x.id === userId);
  if (!p) throw new DemoError('not_found', 'Member not found.');
  if (p.role !== 'rep') throw new DemoError('invalid_input', 'Scenarios are assigned to reps.');
  const unique = [...new Set(keys)];
  for (const k of unique) if (!s.scenarios.some((x) => x.key === k && !x.archived)) throw new DemoError('invalid_scenario', `Unknown or archived scenario: ${k}`);
  s.assignments[userId] = unique;
}

export function scenarioAdmin(s: DemoState) {
  requireManager(s);
  return { scenarios: [...s.scenarios].sort((a, b) => Number(!!a.archived) - Number(!!b.archived) || a.title.localeCompare(b.title)), assignments: Object.fromEntries(Object.entries(s.assignments).filter(([, v]) => v.length)) };
}

// ---------------- access helpers ----------------
function getSessionRaw(s: DemoState, id: string): PracticeSession {
  const x = s.sessions.find((v) => v.id === id);
  if (!x) throw new DemoError('not_found', 'Session not found.');
  return x;
}

export function canView(s: DemoState, session: PracticeSession): boolean {
  const me = currentUser(s);
  return me.active && (me.role === 'manager' || session.repId === me.id);
}

export function getSession(s: DemoState, id: string): PracticeSession {
  const x = getSessionRaw(s, id);
  if (!canView(s, x)) throw new DemoError('not_found', 'Session not found.');
  return x;
}

function ownActiveSession(s: DemoState, id: string): PracticeSession {
  const x = getSessionRaw(s, id);
  if (x.repId !== s.currentUserId) throw new DemoError('not_found', 'Session not found.');
  return x;
}

export function remainingSeconds(s: DemoState): number {
  return s.usage.allowanceSeconds - s.usage.consumedSeconds - s.usage.reservedSeconds;
}

// ---------------- lifecycle ----------------
export function startSession(s: DemoState, input: { scenarioKey: ScenarioKey; drillKey: DrillKey | null; parentSessionId: string | null; idempotencyKey: string }, now = new Date()): PracticeSession {
  const idem = s.idempotency[`start:${input.idempotencyKey}`];
  if (idem) return getSessionRaw(s, idem);
  const me = currentUser(s);
  if (!me.active) throw new DemoError('membership_inactive', 'Your membership is not active.');
  if (me.role !== 'rep') throw new DemoError('forbidden', 'Switch to a rep view to practise.');
  const kind = input.drillKey ? 'drill' : 'full';
  const scenarioKey = input.drillKey ? scenarioForDrill(input.drillKey) : input.scenarioKey;
  // Full sessions: an active scenario the rep may practise. Drills (feedback retries) use the built-in drill scenarios.
  if (!input.drillKey && !allowedScenarios(s, me.id).some((x) => x.key === scenarioKey)) {
    throw new DemoError('scenario_not_available', "This scenario isn't available to you. Choose one from your practice list.");
  }
  const scenario = findScenario(s, scenarioKey);
  if (!scenario) throw new DemoError('invalid_scenario', 'Unknown scenario.');
  if (input.parentSessionId) {
    const parent = getSessionRaw(s, input.parentSessionId);
    if (parent.repId !== me.id) throw new DemoError('invalid_parent', 'Drill parent must be one of your sessions.');
  }
  const { maxSeconds } = sessionLimits(kind);
  if (remainingSeconds(s) < maxSeconds) throw new DemoError('allowance_exhausted', `Not enough practice allowance left: a ${kind === 'drill' ? 'drill' : 'session'} needs ${maxSeconds} seconds reserved.`);
  if (s.sessions.some((x) => x.repId === me.id && x.status === 'active' && x.deadlineAt && new Date(x.deadlineAt) > now)) {
    throw new DemoError('session_in_progress', 'Finish or end your current practice first.');
  }
  const pub = currentPublished(s);
  const opener = input.drillKey ? getDrill(input.drillKey)!.opener : scenario.opener;
  const id = uid('session');
  const session: PracticeSession = {
    id, repId: me.id, repName: me.name, kind, scenarioKey, drillKey: input.drillKey ?? null, parentSessionId: input.parentSessionId ?? null,
    scenarioTitle: scenario.title,
    campaignVersion: pub.version, campaignName: pub.pack.name, rubricVersion: pub.rubric.version, mode: 'demo',
    status: 'active', evaluationStatus: 'none',
    // Clock starts when the opening resident turn is ready (immediately in demo).
    startedAt: iso(now), deadlineAt: iso(new Date(now.getTime() + maxSeconds * 1000)), endedAt: null, endReason: null,
    transcriptRevision: 1,
    turns: [{ id: 'resident-1', sequence: 1, speaker: 'resident', text: opener, source: 'scripted', createdAt: iso(now) }],
    corrections: [], evaluations: [], usedSeconds: null,
  };
  s.sessions.push(session);
  s.usage.reservedSeconds += maxSeconds;
  s.ledger.push({ operationId: `reserve:${id}`, sessionId: id, kind: 'reservation', seconds: maxSeconds, at: iso(now) });
  s.idempotency[`start:${input.idempotencyKey}`] = id;
  return session;
}

/**
 * Options for the standalone demo's live-AI mode (src/client/repo/live-ai.ts): `scriptedReply: false`
 * leaves the resident reply to the caller (commitResidentTurn), and `evaluateOnEnd: false` leaves
 * evaluation of an automatic ending to the caller (saveEvaluation). Defaults keep the scripted demo.
 */
export interface TurnOptions { scriptedReply?: boolean; evaluateOnEnd?: boolean }

export function submitTurn(s: DemoState, sessionId: string, input: { text: string; expectedSequence: number; idempotencyKey: string }, now = new Date(), opts: TurnOptions = {}): PracticeSession {
  const evaluateOnEnd = opts.evaluateOnEnd ?? true;
  const session = ownActiveSession(s, sessionId);
  const key = `turn:${sessionId}:${input.idempotencyKey}`;
  if (s.idempotency[key]) return session;
  if (!currentUser(s).active) throw new DemoError('membership_inactive', 'Your membership is not active.');
  if (session.status !== 'active') throw new DemoError('session_closed', 'This practice has ended.');
  if (session.deadlineAt && now > new Date(session.deadlineAt)) {
    endSession(s, sessionId, { idempotencyKey: `auto-${sessionId}` }, now, 'time_limit');
    throw new DemoError('deadline_passed', 'Time is up — this practice has ended.');
  }
  const nextSeq = session.turns.length + 1;
  if (input.expectedSequence !== nextSeq) throw new DemoError('stale_sequence', 'This turn is out of date. The transcript has been refreshed.');
  const text = input.text.trim().slice(0, 1200);
  if (!text) throw new DemoError('empty_turn', 'Say or type something first.');
  session.turns.push({ id: turnLabel('rep', session.turns), sequence: nextSeq, speaker: 'rep', text, source: 'typed', createdAt: iso(now) });
  s.idempotency[key] = 'done';

  const transcript = transcriptAtRevision(session.turns, [], 1);
  const { maxRepTurns } = sessionLimits(session.kind);
  const directive = residentDirective({ scenarioKey: session.scenarioKey, drillKey: session.drillKey, transcript, maxRepTurns });
  if (directive.kind === 'end') {
    endSession(s, sessionId, { idempotencyKey: `auto-${sessionId}` }, now, directive.reason === 'turn_limit' ? 'turn_limit' : 'resident_ended', evaluateOnEnd);
    return session;
  }
  if (opts.scriptedReply === false) return session;
  const reply = demoResidentReply({ scenarioKey: session.scenarioKey, drillKey: session.drillKey, transcript });
  if (reply.utterance) {
    session.turns.push({ id: turnLabel('resident', session.turns), sequence: session.turns.length + 1, speaker: 'resident', text: reply.utterance, source: 'scripted', createdAt: iso(now) });
  }
  if (reply.endConversation) endSession(s, sessionId, { idempotencyKey: `auto-${sessionId}` }, now, 'resident_ended');
  return session;
}

export function endSession(s: DemoState, sessionId: string, input: { idempotencyKey: string }, now = new Date(), reason: EndReason = 'rep_ended', evaluate = true): PracticeSession {
  const session = ownActiveSession(s, sessionId);
  if (session.status !== 'active') return session; // idempotent: settle once
  const { maxSeconds } = sessionLimits(session.kind);
  const deadline = session.deadlineAt ? new Date(session.deadlineAt) : now;
  const endAt = now > deadline ? deadline : now;
  const used = chargeableSeconds(session.startedAt ? new Date(session.startedAt) : null, endAt, maxSeconds);
  session.status = 'ended';
  session.endedAt = iso(endAt);
  session.endReason = now > deadline ? 'time_limit' : reason;
  session.usedSeconds = used;
  s.usage.reservedSeconds -= maxSeconds;
  s.usage.consumedSeconds += used;
  s.ledger.push({ operationId: `settle:${sessionId}`, sessionId, kind: 'settlement', seconds: used, at: iso(now) });
  s.ledger.push({ operationId: `release:${sessionId}`, sessionId, kind: 'release', seconds: maxSeconds - used, at: iso(now) });
  s.idempotency[`end:${sessionId}:${input.idempotencyKey}`] = 'done';
  session.evaluationStatus = 'pending';
  if (evaluate) runEvaluation(s, session, now);
  return session;
}

/** Adds a resident turn produced outside the engine (live AI or scripted fallback). No-op unless awaiting one. */
export function commitResidentTurn(s: DemoState, sessionId: string, reply: { utterance: string; endConversation: boolean }, source: 'generated' | 'scripted', now = new Date(), evaluateOnEnd = true): PracticeSession {
  const session = ownActiveSession(s, sessionId);
  if (session.status !== 'active' || session.turns.at(-1)?.speaker !== 'rep') return session;
  if (session.deadlineAt && now > new Date(session.deadlineAt)) {
    endSession(s, sessionId, { idempotencyKey: `auto-${sessionId}` }, now, 'time_limit', evaluateOnEnd);
    return session;
  }
  const text = reply.utterance.trim();
  if (text) session.turns.push({ id: turnLabel('resident', session.turns), sequence: session.turns.length + 1, speaker: 'resident', text, source, createdAt: iso(now) });
  if (reply.endConversation) endSession(s, sessionId, { idempotencyKey: `auto-${sessionId}` }, now, 'resident_ended', evaluateOnEnd);
  return session;
}

/** The frozen inputs an evaluator needs for a session's current transcript revision. */
export function evaluationInputs(s: DemoState, sessionId: string) {
  const session = getSessionRaw(s, sessionId);
  const pub = s.campaign.published.find((p) => p.version === session.campaignVersion) ?? currentPublished(s);
  return { session, pack: pub.pack, rubric: pub.rubric, transcriptRevision: session.transcriptRevision, transcript: transcriptAtRevision(session.turns, session.corrections, session.transcriptRevision) };
}

/** Marks an evaluation as in progress outside the engine (shown as "Feedback pending"). */
export function markEvaluationRunning(s: DemoState, sessionId: string): PracticeSession {
  const session = getSessionRaw(s, sessionId);
  if (session.status !== 'active' && session.evaluationStatus !== 'completed') session.evaluationStatus = 'running';
  return session;
}

/**
 * Stores an evaluation produced outside the engine. The result must already have passed
 * validateEvaluation; a stale revision or a duplicate success is ignored (same rule as the database).
 */
export function saveEvaluation(s: DemoState, sessionId: string, e: { transcriptRevision: number; evaluatorKind: 'demo' | 'anthropic'; model: string; promptVersion: string; status: 'completed' | 'unavailable' | 'pending'; result: EvaluationResult | null; errors?: string[] }, now = new Date()): PracticeSession {
  const session = getSessionRaw(s, sessionId);
  if (e.transcriptRevision !== session.transcriptRevision) return session;
  if (session.evaluations.some((x) => x.status === 'completed' && x.transcriptRevision === e.transcriptRevision)) { session.evaluationStatus = 'completed'; return session; }
  if (e.status === 'pending') { session.evaluationStatus = 'pending'; return session; }
  session.evaluations.push({ id: uid('eval'), transcriptRevision: e.transcriptRevision, evaluatorKind: e.evaluatorKind, model: e.model, promptVersion: e.promptVersion, status: e.status, result: e.status === 'completed' ? e.result : null, createdAt: iso(now), errors: e.errors });
  session.evaluationStatus = e.status;
  return session;
}

/** Idempotent: a completed evaluation for the current transcript revision is never duplicated. */
export function runEvaluation(s: DemoState, session: PracticeSession, now = new Date()): PracticeSession {
  if (session.evaluations.some((e) => e.status === 'completed' && e.transcriptRevision === session.transcriptRevision)) {
    session.evaluationStatus = 'completed';
    return session;
  }
  const pub = s.campaign.published.find((p) => p.version === session.campaignVersion) ?? currentPublished(s);
  const transcript = transcriptAtRevision(session.turns, session.corrections, session.transcriptRevision);
  const result = demoEvaluate({ transcript, transcriptRevision: session.transcriptRevision, rubric: pub.rubric, scenarioKey: session.scenarioKey, drillKey: session.drillKey, mustSay: pub.pack.must_say, neverSay: pub.pack.never_say });
  const v = validateEvaluation(result, validationContext({ transcript, transcriptRevision: session.transcriptRevision, rubricVersion: pub.rubric.version, pack: pub.pack, scenarioKey: session.scenarioKey }));
  session.evaluations.push({
    id: uid('eval'), transcriptRevision: session.transcriptRevision, evaluatorKind: 'demo', model: DEMO_EVALUATOR_VERSION, promptVersion: 'n/a (demo rules)',
    status: v.ok ? 'completed' : 'unavailable', result: v.ok ? v.result : null, createdAt: iso(now), errors: v.ok ? undefined : v.errors,
  });
  session.evaluationStatus = v.ok ? 'completed' : 'unavailable';
  return session;
}

export function retryEvaluation(s: DemoState, sessionId: string, now = new Date()): PracticeSession {
  const session = getSession(s, sessionId);
  const me = currentUser(s);
  if (session.repId !== me.id && me.role !== 'manager') throw new DemoError('not_found', 'Session not found.');
  if (session.status === 'active') throw new DemoError('session_active', 'End the practice first.');
  return runEvaluation(s, session, now);
}

export function reportFeedback(s: DemoState, sessionId: string, input: { reason: FeedbackReport['reason']; description: string }, now = new Date()): FeedbackReport {
  const session = getSession(s, sessionId);
  if (session.repId !== s.currentUserId) throw new DemoError('forbidden', 'Only the rep who practised can report feedback errors.');
  const r: FeedbackReport = { id: uid('report'), sessionId, reporterId: s.currentUserId, reason: input.reason, description: input.description.slice(0, 1000), status: 'open', createdAt: iso(now) };
  s.reports.push(r);
  return r;
}

// ---------------- manager ----------------
function requireManager(s: DemoState) {
  const me = currentUser(s);
  if (me.role !== 'manager' || !me.active) throw new DemoError('forbidden', 'Manager access required.');
  return me;
}

export function addReview(s: DemoState, sessionId: string, input: { note: string; resolution: ManagerReview['resolution']; reportId?: string | null }, now = new Date()): ManagerReview {
  const me = requireManager(s);
  getSession(s, sessionId);
  const r: ManagerReview = { id: uid('review'), sessionId, managerId: me.id, managerName: me.name, note: input.note.slice(0, 2000), resolution: input.resolution, createdAt: iso(now) };
  s.reviews.push(r); // append-only
  if (input.reportId) {
    const rep = s.reports.find((x) => x.id === input.reportId && x.sessionId === sessionId);
    if (rep && input.resolution === 'resolved') rep.status = 'resolved';
  }
  return r;
}

export function addCorrection(s: DemoState, sessionId: string, input: { turnId: string; correctedText: string; note?: string }, now = new Date(), evaluate = true): PracticeSession {
  const me = requireManager(s);
  const session = getSession(s, sessionId);
  if (session.status === 'active') throw new DemoError('session_active', 'Corrections apply to ended sessions.');
  if (!session.turns.some((t) => t.id === input.turnId)) throw new DemoError('invalid_turn', 'Unknown turn.');
  const revision = session.transcriptRevision + 1;
  session.corrections.push({ turnId: input.turnId, revision, correctedText: input.correctedText.trim(), correctedBy: me.name, createdAt: iso(now), note: input.note });
  session.transcriptRevision = revision;
  session.evaluationStatus = 'pending';
  return evaluate ? runEvaluation(s, session, now) : session;
}

export function summaries(s: DemoState): TeamSessionSummary[] {
  return s.sessions.map((x) => {
    const ev = [...x.evaluations].reverse().find((e) => e.status === 'completed');
    const reviewed = s.reviews.some((r) => r.sessionId === x.id && r.resolution === 'resolved');
    return {
      id: x.id, repId: x.repId, repName: x.repName, scenarioKey: x.scenarioKey, scenarioTitle: x.scenarioTitle ?? findScenario(s, x.scenarioKey)?.title, drillKey: x.drillKey,
      status: x.status, evaluationStatus: x.evaluationStatus, endedAt: x.endedAt, usedSeconds: x.usedSeconds,
      rubricVersion: x.rubricVersion,
      scores: ev?.result ? Object.fromEntries(ev.result.dimensions.map((d) => [d.key, d.score])) : null,
      openConcerns: reviewed ? 0 : ev?.result?.concerns.length ?? 0,
      openReports: s.reports.filter((r) => r.sessionId === x.id && r.status === 'open').length,
    };
  });
}

export function overview(s: DemoState, periodDays: number, now = new Date()) {
  requireManager(s);
  return computeOverview({
    sessions: summaries(s), periodDays, now,
    activeRepIds: s.people.filter((p) => p.role === 'rep' && p.active).map((p) => p.id),
    currentRubricVersion: currentPublished(s).rubric.version,
  });
}

function rosterMembers(s: DemoState) {
  return s.people.map((p) => ({ userId: p.id, name: p.name, email: p.email, role: p.role, active: p.active, sessions: 0 }));
}

/** Rep database: every member with practice statistics and scenario assignments. */
export function directory(s: DemoState): RepDirectoryRow[] {
  requireManager(s);
  return buildDirectory({ members: rosterMembers(s), sessions: summaries(s), assignments: s.assignments, currentRubricVersion: currentPublished(s).rubric.version });
}

export function repProfile(s: DemoState, userId: string, now = new Date()): RepProfile {
  requireManager(s);
  const member = rosterMembers(s).find((m) => m.userId === userId);
  if (!member) throw new DemoError('not_found', 'Member not found.');
  return buildRepProfile({ member, sessions: summaries(s), assignments: s.assignments, currentRubricVersion: currentPublished(s).rubric.version, now });
}

/** Simulated sign-in (demo only): any fictional person, no password. */
export function signIn(s: DemoState, userId: string) {
  const p = s.people.find((x) => x.id === userId);
  if (!p) throw new DemoError('not_found', 'Unknown demo person.');
  if (!p.active) throw new DemoError('membership_inactive', `${p.name} has been deactivated by the manager, so they can't sign in.`);
  s.currentUserId = userId;
  s.signedIn = true;
}
export function signOut(s: DemoState) { s.signedIn = false; }

export function createInvitation(s: DemoState, input: { email: string; role: 'rep' | 'manager' }, now = new Date()): { invitation: DemoInvitation; link: string } {
  requireManager(s);
  const seats = s.people.filter((p) => p.role === 'rep' && p.active).length + s.invitations.filter((i) => !i.usedAt && !i.revokedAt && new Date(i.expiresAt) > now && i.role === 'rep').length;
  if (input.role === 'rep' && seats >= 5) throw new DemoError('seat_limit', 'Seat limit reached for this pilot (5 reps including pending invitations).');
  const inv: DemoInvitation = { id: uid('inv'), email: input.email.toLowerCase(), role: input.role, createdAt: iso(now), expiresAt: iso(new Date(now.getTime() + 7 * 86400_000)), usedAt: null, revokedAt: null };
  s.invitations.push(inv);
  return { invitation: inv, link: `/invite/demo-${inv.id}` };
}

export function revokeInvitation(s: DemoState, id: string, now = new Date()) {
  requireManager(s);
  const inv = s.invitations.find((i) => i.id === id);
  if (!inv) throw new DemoError('not_found', 'Invitation not found.');
  if (!inv.usedAt && !inv.revokedAt) inv.revokedAt = iso(now);
}

export function setMemberActive(s: DemoState, userId: string, active: boolean) {
  const me = requireManager(s);
  if (userId === me.id) throw new DemoError('forbidden', 'You cannot change your own membership.');
  const p = s.people.find((x) => x.id === userId);
  if (!p) throw new DemoError('not_found', 'Member not found.');
  p.active = active;
}

export function saveDraft(s: DemoState, pack: CampaignPack, rubric: RubricVersion, now = new Date()) {
  requireManager(s);
  s.campaign.draft = { pack, rubric, updatedAt: iso(now) };
}

export function publishDraft(s: DemoState, now = new Date()): PublishedVersion {
  const me = requireManager(s);
  if (!s.campaign.draft) throw new DemoError('no_draft', 'There is no draft to publish.');
  const prev = currentPublished(s);
  const version = prev.version + 1;
  const rubricChanged = JSON.stringify(s.campaign.draft.rubric.dimensions) !== JSON.stringify(prev.rubric.dimensions);
  const v: PublishedVersion = {
    version,
    pack: { ...s.campaign.draft.pack, version },
    rubric: rubricChanged ? { ...s.campaign.draft.rubric, version: `demo-${version}`, approvedBy: me.name, approvedAt: iso(now) } : prev.rubric,
    publishedAt: iso(now), approvedBy: me.name,
  };
  s.campaign.published.push(v); // older versions stay frozen; existing sessions keep their references
  s.campaign.draft = null;
  return v;
}

export function requestDeletion(s: DemoState, scope: string, now = new Date()) {
  s.deletionRequests.push({ id: uid('del'), userId: s.currentUserId, scope, requestedAt: iso(now), status: 'requested' });
}

/** Expires sessions past their deadline (demo equivalent of the maintenance job). */
export function recoverExpired(s: DemoState, now = new Date()) {
  for (const x of s.sessions) {
    if (x.status === 'active' && x.deadlineAt && now > new Date(x.deadlineAt)) {
      const prev = s.currentUserId;
      s.currentUserId = x.repId;
      endSession(s, x.id, { idempotencyKey: `expire-${x.id}` }, now, 'time_limit');
      s.currentUserId = prev;
    }
  }
}
