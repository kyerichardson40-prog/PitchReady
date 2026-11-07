/**
 * Live AI for the standalone demo (src/static-demo/live-ai.ts + DemoRepository), with a stubbed
 * `ask` in place of claude.ai's `sample` capability. No network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeLiveAi, type Message } from '../../src/static-demo/live-ai.ts';
import { DemoRepository } from '../../src/client/repo/demo-repo.ts';
import type { LiveAiEngine } from '../../src/client/repo/types.ts';
import * as E from '../../lib/demo/engine.ts';
import { demoEvaluate } from '../../lib/demo/evaluator.ts';
import { getScenario } from '../../lib/content/scenarios.ts';
import { EVALUATOR_SYSTEM_PROMPT, RESIDENT_SYSTEM_PROMPT } from '../../lib/ai/prompts.ts';

const dataOf = (m: Message[]) => { const t = m[0]!.content; return JSON.parse(t.slice(t.indexOf('\n', t.indexOf('DATA (JSON')) + 1)); };

function endedSession() {
  const s = E.createSeedState();
  const x = E.startSession(s, { scenarioKey: 'existing-donor', drillKey: null, parentSessionId: null, idempotencyKey: 'k-start-1' });
  E.submitTurn(s, x.id, { text: 'Hi, I am Sam from the fictional Neighbourhood Meal Project. Have you got a moment?', expectedSequence: 2, idempotencyKey: 'k-turn-1' });
  E.endSession(s, x.id, { idempotencyKey: 'k-end-1' }, new Date(), 'rep_ended', false);
  return { s, id: x.id };
}

test('resident: instructions lead, transcript is labelled data, quick tier, extra keys tolerated', async () => {
  const calls: { m: Message[]; tier: string }[] = [];
  const ai = new ClaudeLiveAi(async (m, tier) => { calls.push({ m, tier }); return { utterance: 'Go on, quickly.', endConversation: false, reason: null, mood: 'hurried' }; });
  const s = E.createSeedState();
  const x = E.startSession(s, { scenarioKey: 'existing-donor', drillKey: null, parentSessionId: null, idempotencyKey: 'k-start-2' });
  E.submitTurn(s, x.id, { text: 'Hi, I am Sam.', expectedSequence: 2, idempotencyKey: 'k-turn-2' }, new Date(), { scriptedReply: false });
  const { transcript, pack } = E.evaluationInputs(s, x.id);
  const r = await ai.residentReply({ scenario: getScenario('existing-donor')!, drill: null, campaign: pack, transcript });
  assert.deepEqual(r, { utterance: 'Go on, quickly.', endConversation: false });
  assert.equal(calls[0]!.tier, 'quick');
  const text = calls[0]!.m[0]!.content;
  assert.ok(text.indexOf(RESIDENT_SYSTEM_PROMPT) < text.indexOf('DATA (JSON'), 'instructions come before data');
  assert.equal(dataOf(calls[0]!.m).TRANSCRIPT_UNTRUSTED.at(-1).speaker, 'rep');
});

test('resident: output outside the schema is rejected', async () => {
  const ai = new ClaudeLiveAi(async () => ({ utterance: 42 }));
  const { s, id } = endedSession();
  const { transcript, pack } = E.evaluationInputs(s, id);
  await assert.rejects(ai.residentReply({ scenario: getScenario('existing-donor')!, drill: null, campaign: pack, transcript }), (e: any) => e.code === 'invalid_output');
});

test('evaluator: invalid first answer → exactly one repair with the errors → validated result', async () => {
  const { s, id } = endedSession();
  const inp = E.evaluationInputs(s, id);
  const good = demoEvaluate({ transcript: inp.transcript, transcriptRevision: inp.transcriptRevision, rubric: inp.rubric, scenarioKey: 'existing-donor', drillKey: null, mustSay: inp.pack.must_say, neverSay: inp.pack.never_say });
  const bad = structuredClone(good);
  bad.dimensions[0]!.evidence = [{ turn_id: 'rep-1', quote: 'words the rep never said' }];
  bad.dimensions[0]!.score = 3;
  const calls: Message[][] = [];
  const ai = new ClaudeLiveAi(async (m, tier) => { assert.equal(tier, 'default'); calls.push(m); return calls.length === 1 ? bad : good; });
  const v = await ai.evaluate({ scenario: getScenario('existing-donor')!, drill: null, campaign: inp.pack, rubric: inp.rubric, transcript: inp.transcript, transcriptRevision: inp.transcriptRevision });
  assert.equal(v.ok, true);
  assert.equal(calls.length, 2);
  assert.ok(calls[0]![0]!.content.startsWith('APPLICATION INSTRUCTIONS') && calls[0]![0]!.content.includes(EVALUATOR_SYSTEM_PROMPT));
  assert.equal(calls[1]!.at(-2)!.role, 'assistant');
  assert.match(calls[1]!.at(-1)!.content, /APPLICATION_VALIDATION_ERRORS/);
});

test('evaluator: still invalid after the repair → not ok (never shown as feedback)', async () => {
  const { s, id } = endedSession();
  const inp = E.evaluationInputs(s, id);
  const ai = new ClaudeLiveAi(async () => ({ schema_version: '1.0' }));
  const v = await ai.evaluate({ scenario: getScenario('existing-donor')!, drill: null, campaign: inp.pack, rubric: inp.rubric, transcript: inp.transcript, transcriptRevision: inp.transcriptRevision });
  assert.equal(v.ok, false);
});

// ---- DemoRepository with a stub engine ----
const tick = () => new Promise((r) => setTimeout(r, 0));

function stubEngine(over: Partial<LiveAiEngine> = {}): LiveAiEngine {
  return {
    label: 'stub', promptVersion: 'evaluator-v2',
    residentReply: async () => ({ utterance: 'Live line from Claude.', endConversation: false }),
    evaluate: async (i) => ({ ok: true, result: demoEvaluate({ transcript: i.transcript, transcriptRevision: i.transcriptRevision, rubric: i.rubric, scenarioKey: i.scenario.key, drillKey: null, mustSay: i.campaign.must_say, neverSay: i.campaign.never_say }) }),
    ...over,
  };
}

async function practise(repo: DemoRepository) {
  await repo.demoReset();
  const { session } = await repo.startSession({ scenarioKey: 'busy', drillKey: null, parentSessionId: null, idempotencyKey: 'k-s-' + Math.random() });
  const r = await repo.submitTypedTurn(session.id, { text: 'Hi, I am Sam from the fictional Neighbourhood Meal Project.', expectedSequence: 2, idempotencyKey: 'k-t-' + Math.random() });
  return { id: session.id, r };
}

test('repo live: Claude writes the resident turn; feedback runs in the background and is stored as AI feedback', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const base = stubEngine();
  const repo = new DemoRepository(stubEngine({ evaluate: async (i) => { await gate; return base.evaluate(i); } }));
  assert.equal((await repo.getContext()).liveAi, true);
  const { id, r } = await practise(repo);
  const last = r.session.turns.at(-1)!;
  assert.equal(last.text, 'Live line from Claude.');
  assert.equal(last.source, 'generated');
  const ended = await repo.endSession(id, { idempotencyKey: 'k-e-1' });
  assert.equal(ended.evaluationStatus, 'running');
  release(); await tick(); await tick();
  const done = (await repo.getSession(id)).session;
  assert.equal(done.evaluationStatus, 'completed');
  assert.equal(done.evaluations.at(-1)!.evaluatorKind, 'anthropic');
  assert.equal(done.evaluations.at(-1)!.model, 'stub');
});

test('repo live: resident failure falls back to a labelled scripted line; refusal of consent turns live AI off', async () => {
  const repo = new DemoRepository(stubEngine({ residentReply: async () => { throw { code: 'not_granted', message: 'no' }; } }));
  const { r } = await practise(repo);
  assert.equal(r.session.turns.at(-1)!.source, 'scripted');
  assert.match(r.notices.join(' '), /scripted/);
  assert.equal(repo.liveAi!.enabled, false);
  assert.equal((await repo.getContext()).liveAi, false);
});

test('repo live: evaluator outage leaves feedback pending with a reason; retry completes it', async () => {
  let fail = true;
  const base = stubEngine();
  const repo = new DemoRepository(stubEngine({ evaluate: async (i) => { if (fail) throw { code: 'upstream_error', message: 'x' }; return base.evaluate(i); } }));
  const { id } = await practise(repo);
  await repo.endSession(id, { idempotencyKey: 'k-e-2' });
  await tick(); await tick();
  assert.equal((await repo.getSession(id)).session.evaluationStatus, 'pending');
  assert.ok(repo.liveAi!.lastError);
  fail = false;
  await repo.retryEvaluation(id);
  await tick(); await tick();
  assert.equal((await repo.getSession(id)).session.evaluationStatus, 'completed');
});

test('repo live: switching Live AI off restores the scripted demo and rule-based feedback', async () => {
  const repo = new DemoRepository(stubEngine());
  repo.liveAi!.setEnabled(false);
  const { id, r } = await practise(repo);
  assert.notEqual(r.session.turns.at(-1)!.text, 'Live line from Claude.');
  const ended = await repo.endSession(id, { idempotencyKey: 'k-e-3' });
  assert.equal(ended.evaluations.at(-1)?.evaluatorKind, 'demo');
});
