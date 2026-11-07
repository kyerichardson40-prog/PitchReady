import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../lib/demo/engine.ts';
import { SCENARIOS } from '../../lib/content/scenarios.ts';

const key = () => `k-${Math.random().toString(36).slice(2, 12)}`;

test('seed has fictional history incl. a concern and a pending evaluation', () => {
  const s = E.createSeedState();
  assert.equal(s.sessions.length, 10);
  assert.ok(s.sessions.some((x) => x.evaluations.at(-1)?.result?.concerns.some((c) => c.type === 'banned_phrase')), 'seed shows a never-say flag');
  assert.equal(s.signedIn, false, 'demo opens signed out on the role picker');
  assert.ok(s.sessions.some((x) => x.evaluationStatus === 'pending'));
  assert.ok(s.sessions.some((x) => x.evaluations.at(-1)?.result?.concerns.some((c) => c.type === 'unsupported_campaign_claim')));
  assert.equal(s.usage.reservedSeconds, 0, 'no stuck reservations after seeding');
});

for (const sc of SCENARIOS) {
  test(`scenario ${sc.key}: typed turns → end → validated demo feedback with a drill`, () => {
    const s = E.createSeedState();
    const now = new Date();
    const session = E.startSession(s, { scenarioKey: sc.key, drillKey: null, parentSessionId: null, idempotencyKey: key() }, now);
    assert.equal(session.turns[0]!.text, sc.opener);
    E.submitTurn(s, session.id, { text: "Hi, I'm Sam from the fictional Neighbourhood Meal Project. Have you got a moment?", expectedSequence: 2, idempotencyKey: key() }, now);
    if (session.status === 'active') E.endSession(s, session.id, { idempotencyKey: key() }, new Date(now.getTime() + 30_000));
    assert.equal(session.status, 'ended');
    assert.equal(session.evaluationStatus, 'completed');
    const ev = session.evaluations.at(-1)!;
    assert.equal(ev.evaluatorKind, 'demo');
    assert.ok(ev.result!.retry.drill_key);
    assert.equal(s.usage.reservedSeconds, 0);
  });
}

test('firm refusal ends after exactly one rep turn', () => {
  const s = E.createSeedState();
  const x = E.startSession(s, { scenarioKey: 'firm-refusal', drillKey: null, parentSessionId: null, idempotencyKey: key() });
  E.submitTurn(s, x.id, { text: 'But surely you can spare ten pounds.', expectedSequence: 2, idempotencyKey: key() });
  assert.equal(x.status, 'ended');
  assert.equal(x.turns.length, 2);
  assert.ok(x.evaluations.at(-1)!.result!.concerns.some((c) => c.type === 'ignored_stop_request'));
});

test('duplicate turn and end requests do not duplicate records or settlements', () => {
  const s = E.createSeedState();
  const x = E.startSession(s, { scenarioKey: 'busy', drillKey: null, parentSessionId: null, idempotencyKey: key() });
  const k = key();
  E.submitTurn(s, x.id, { text: "Hi, I'm Sam. Have you got a moment?", expectedSequence: 2, idempotencyKey: k });
  const n = x.turns.length;
  E.submitTurn(s, x.id, { text: "Hi, I'm Sam. Have you got a moment?", expectedSequence: 2, idempotencyKey: k });
  assert.equal(x.turns.length, n);
  assert.throws(() => E.submitTurn(s, x.id, { text: 'stale', expectedSequence: 2, idempotencyKey: key() }), /out of date/);
  E.endSession(s, x.id, { idempotencyKey: key() });
  const consumed = s.usage.consumedSeconds;
  E.endSession(s, x.id, { idempotencyKey: key() });
  assert.equal(s.usage.consumedSeconds, consumed);
  E.retryEvaluation(s, x.id);
  assert.equal(x.evaluations.length, 1);
});

test('deadline is enforced from stored time, and drills are capped at 60s', () => {
  const s = E.createSeedState();
  const t0 = new Date();
  const x = E.startSession(s, { scenarioKey: 'busy', drillKey: 'busy', parentSessionId: null, idempotencyKey: key() }, t0);
  assert.equal(x.kind, 'drill');
  assert.throws(() => E.submitTurn(s, x.id, { text: 'Hello there, quick one?', expectedSequence: 2, idempotencyKey: key() }, new Date(t0.getTime() + 61_000)), /Time is up/);
  assert.equal(x.status, 'ended');
  assert.equal(x.usedSeconds, 60);
});

test('allowance blocks a start that cannot be reserved', () => {
  const s = E.createSeedState();
  s.usage.consumedSeconds = s.usage.allowanceSeconds - 100;
  assert.throws(() => E.startSession(s, { scenarioKey: 'busy', drillKey: null, parentSessionId: null, idempotencyKey: key() }), /allowance/);
});

test('rep cannot see other reps sessions; manager can; correction creates new revision', () => {
  const s = E.createSeedState();
  const priya = s.sessions.find((x) => x.repId === 'demo-rep-priya')!;
  assert.throws(() => E.getSession(s, priya.id), /not found/);
  s.currentUserId = 'demo-manager';
  assert.equal(E.getSession(s, priya.id).id, priya.id);
  const before = priya.evaluations.length;
  E.addCorrection(s, priya.id, { turnId: 'rep-1', correctedText: "Of course. Thanks for your time; I'll leave you to it now." });
  assert.equal(priya.transcriptRevision, 2);
  assert.equal(priya.evaluations.length, before + 1);
  assert.equal(priya.evaluations[0]!.transcriptRevision, 1, 'old feedback preserved');
  const ov = E.overview(s, 14);
  assert.equal(ov.activeReps, 4, 'Dev is deactivated');
});

test('publishing a new version leaves old sessions on their version', () => {
  const s = E.createSeedState();
  s.currentUserId = 'demo-manager';
  const pub = E.currentPublished(s);
  E.saveDraft(s, { ...pub.pack, name: 'Edited fictional demo' }, pub.rubric);
  const v2 = E.publishDraft(s);
  assert.equal(v2.version, 2);
  assert.ok(s.sessions.every((x) => x.campaignVersion === 1));
});
