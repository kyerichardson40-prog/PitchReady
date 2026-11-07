/** Say rules, agency-written scenarios, assignments and the rep database in the demo engine. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../lib/demo/engine.ts';
import { demoBannedPhrases, demoRequiredStatements } from '../../lib/demo/evaluator.ts';
import { validateEvaluation } from '../../lib/domain/evaluation-validator.ts';
import { FICTIONAL_CAMPAIGN } from '../../lib/content/campaign.ts';
import { campaignPackSchema } from '../../lib/domain/schemas.ts';
import type { TranscriptTurn } from '../../lib/domain/transcript.ts';

const rep = (id: string, text: string): TranscriptTurn => ({ id, speaker: 'rep', text, corrected: false });
const key = () => `k-${Math.random().toString(36).slice(2)}`;
const scenario = { title: 'Worried about money', persona: 'Jamie', opener: "Money's tight.", objection: 'Cost of living', goal: 'Be kind.', allowedEnding: 'A kind goodbye.', behaviour: 'Polite.', skill: 'Empathy' };

test('must-say checklist by cue words; quotes are exact excerpts', () => {
  const turns = [rep('rep-1', "Hi, I'm Sam from the fictional project."), rep('rep-2', 'It is completely voluntary, NO PRESSURE.')];
  const out = demoRequiredStatements(FICTIONAL_CAMPAIGN.must_say, turns);
  assert.deepEqual(out.map((r) => [r.id, r.said]), [['M1', true], ['M2', true]]);
  for (const r of out) for (const e of r.evidence) assert.ok(turns.find((t) => t.id === e.turn_id)!.text.includes(e.quote));
  assert.deepEqual(demoRequiredStatements(FICTIONAL_CAMPAIGN.must_say, [rep('rep-1', 'Hello there.')]).map((r) => r.said), [false, false]);
});

test('never-say phrases are flagged case-insensitively with the exact words used', () => {
  const c = demoBannedPhrases(['you have to', 'last chance'], [rep('rep-1', 'Honestly You Have To try it, it is the Last Chance!')]);
  assert.deepEqual(c.map((x) => x.evidence[0]!.quote), ['You Have To', 'Last Chance']);
  assert.ok(c.every((x) => x.type === 'banned_phrase'));
});

test('validator: checklist must cover each must-say id once; "said" needs rep evidence', () => {
  const transcript = [rep('rep-1', "Hi, I'm Sam.")];
  const ctx = { transcript, transcriptRevision: 1, rubricVersion: 'r', approvedFacts: FICTIONAL_CAMPAIGN.approved_facts, mustSayIds: ['M1', 'M2'], scenarioKey: 'busy' };
  const dims = ['introduction', 'accuracy', 'listening', 'next_step', 'respect'].map((k) => ({ key: k, score: null, reason: 'Not observed.', evidence: [] }));
  const base = (req: unknown) => ({ schema_version: '1.1', rubric_version: 'r', transcript_revision: 1, dimensions: dims, strength: null, improvement: null, concerns: [], required_statements: req, retry: { objective: 'x', scenario_key: 'busy', drill_key: null, max_seconds: 60 }, limitations: [] });
  const not = { id: 'M2', said: false, evidence: [] };
  assert.equal(validateEvaluation(base([{ id: 'M1', said: true, evidence: [{ turn_id: 'rep-1', quote: "I'm Sam" }] }, not]), ctx).ok, true);
  assert.equal(validateEvaluation(base([not]), ctx).ok, false, 'missing M1');
  assert.equal(validateEvaluation(base([{ id: 'M1', said: true, evidence: [] }, not]), ctx).ok, false, 'said without evidence');
  assert.equal(validateEvaluation(base([{ id: 'M1', said: false, evidence: [{ turn_id: 'rep-1', quote: "I'm Sam" }] }, not]), ctx).ok, false, 'not said with evidence');
  assert.equal(validateEvaluation(base([{ id: 'M1', said: false, evidence: [] }, not, { id: 'M3', said: false, evidence: [] }]), ctx).ok, false, 'unknown id');
  const retryElsewhere = { ...base([{ id: 'M1', said: false, evidence: [] }, not]), retry: { objective: 'x', scenario_key: 'sceptical', drill_key: null, max_seconds: 60 } };
  assert.equal(validateEvaluation(retryElsewhere, ctx).ok, false, 'retry without a drill must be the same scenario');
});

test('campaign pack: say-rule fields default for older packs and reject duplicates', () => {
  const { must_say: _m, never_say: _n, objection_answers: _o, ...old } = FICTIONAL_CAMPAIGN;
  const parsed = campaignPackSchema.parse(old);
  assert.deepEqual([parsed.must_say, parsed.never_say, parsed.objection_answers], [[], [], []]);
  assert.equal(campaignPackSchema.safeParse({ ...FICTIONAL_CAMPAIGN, must_say: [{ id: 'M1', text: 'a', cues: [] }, { id: 'M1', text: 'b', cues: [] }] }).success, false);
});

test('engine: manager writes a scenario, assigns it, the rep may start only that; archive blocks it', () => {
  const s = E.createSeedState();
  s.currentUserId = 'demo-manager';
  const { key: k } = E.saveScenario(s, { ...scenario, key: null });
  assert.equal(k, 'worried-about-money');
  assert.equal(E.saveScenario(s, { ...scenario, key: k, title: 'Money worries' }).version, 2);
  E.setAssignments(s, 'demo-rep-priya', [k]);
  assert.throws(() => E.setAssignments(s, 'demo-manager', [k]), /assigned to reps/);
  assert.throws(() => E.setAssignments(s, 'demo-rep-priya', ['nope']), /Unknown or archived/);
  assert.deepEqual(E.allowedScenarios(s, 'demo-rep-priya').map((x) => x.key), [k]);
  s.currentUserId = 'demo-rep-priya';
  assert.throws(() => E.startSession(s, { scenarioKey: 'busy', drillKey: null, parentSessionId: null, idempotencyKey: key() }), /isn't available/);
  const x = E.startSession(s, { scenarioKey: k, drillKey: null, parentSessionId: null, idempotencyKey: key() });
  assert.equal(x.scenarioTitle, 'Money worries');
  E.submitTurn(s, x.id, { text: "Hi, I'm Priya from the fictional project. No pressure at all.", expectedSequence: 2, idempotencyKey: key() });
  const ended = E.endSession(s, x.id, { idempotencyKey: key() });
  assert.equal(ended.evaluationStatus, 'completed', 'demo feedback for an agency-written scenario validates');
  s.currentUserId = 'demo-manager';
  E.setScenarioArchived(s, k, true);
  assert.deepEqual(s.assignments['demo-rep-priya'], []);
  assert.ok(!E.allowedScenarios(s, 'demo-rep-priya').some((v) => v.key === k));
  s.currentUserId = 'demo-rep-priya';
  assert.throws(() => E.saveScenario(s, { ...scenario, key: null }), /Manager access/);
});

test('engine: rep database and simulated sign-in', () => {
  const s = E.createSeedState();
  assert.throws(() => E.signIn(s, 'demo-rep-dev'), /deactivated/);
  E.signIn(s, 'demo-manager');
  assert.equal(s.signedIn, true);
  const dir = E.directory(s);
  const tom = dir.find((r) => r.userId === 'demo-rep-tom')!;
  assert.deepEqual(tom.assignedKeys, ['busy', 'existing-donor', 'new-neighbour']);
  assert.ok(tom.openFlags >= 1, 'banned phrase counted as an open flag');
  const prof = E.repProfile(s, 'demo-rep-tom');
  assert.equal(prof.breakdown.length, 5);
  assert.equal(prof.sessions.length, 2);
  E.signOut(s);
  assert.equal(s.signedIn, false);
});
