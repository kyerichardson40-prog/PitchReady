import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../lib/demo/engine.ts';
import { limitsOfSession, practiceMinutesOf, sessionLimits } from '../../lib/domain/limits.ts';
import { chargeableSeconds } from '../../lib/domain/session-rules.ts';
import { campaignPackSchema } from '../../lib/domain/schemas.ts';
import { RESIDENT_PROMPT_VERSION, RESIDENT_SYSTEM_PROMPT } from '../../lib/ai/prompts.ts';

const key = () => `k-${Math.random().toString(36).slice(2, 12)}`;

test('practice length: 3/5/10 minutes scale replies; drills stay 60 s; bad values fall back to 3', () => {
  assert.deepEqual(sessionLimits('full'), { maxSeconds: 180, maxRepTurns: 12 });
  assert.deepEqual(sessionLimits('full', 5), { maxSeconds: 300, maxRepTurns: 20 });
  assert.deepEqual(sessionLimits('full', 10), { maxSeconds: 600, maxRepTurns: 40 });
  assert.deepEqual(sessionLimits('drill', 10), { maxSeconds: 60, maxRepTurns: 5 });
  assert.equal(practiceMinutesOf({ practice_minutes: 7 }), 3);
  assert.equal(practiceMinutesOf(null), 3);
  assert.deepEqual(limitsOfSession({ kind: 'full', maxSeconds: 600, maxRepTurns: 40 }), { maxSeconds: 600, maxRepTurns: 40 });
  assert.deepEqual(limitsOfSession({ kind: 'full' }), { maxSeconds: 180, maxRepTurns: 12 }, 'older sessions without frozen limits');
});

test('the campaign pack accepts 3, 5 or 10 minutes only', () => {
  const base = E.createSeedState().campaign.published[0]!.pack;
  assert.ok(campaignPackSchema.safeParse({ ...base, practice_minutes: 10 }).success);
  assert.ok(!campaignPackSchema.safeParse({ ...base, practice_minutes: 7 }).success);
});

test('charged time excludes paused time and is capped', () => {
  const t0 = new Date('2026-11-09T10:00:00Z');
  assert.equal(chargeableSeconds(t0, new Date(t0.getTime() + 100_000), 180, 30), 70);
  assert.equal(chargeableSeconds(t0, new Date(t0.getTime() + 400_000), 180, 30), 180);
  assert.equal(chargeableSeconds(t0, new Date(t0.getTime() + 10_000), 180, 30), 0);
});

test('demo: a 10-minute campaign gives 10-minute sessions with 40 replies', () => {
  const s = E.createSeedState();
  const pub = s.campaign.published.at(-1)!;
  const rep = s.currentUserId;
  s.currentUserId = s.people.find((p) => p.role === 'manager')!.id;
  E.saveDraft(s, { ...pub.pack, practice_minutes: 10 }, pub.rubric);
  E.publishDraft(s);
  s.currentUserId = rep;
  const x = E.startSession(s, { scenarioKey: 'busy', drillKey: null, parentSessionId: null, idempotencyKey: key() });
  assert.equal(x.maxSeconds, 600);
  assert.equal(x.maxRepTurns, 40);
});

test('demo live AI: the clock pauses while the reply is prepared and that time is not charged', () => {
  const s = E.createSeedState();
  const t0 = new Date();
  const x = E.startSession(s, { scenarioKey: 'busy', drillKey: null, parentSessionId: null, idempotencyKey: key() }, t0);
  const deadline0 = new Date(x.deadlineAt!).getTime();
  E.submitTurn(s, x.id, { text: "Hi, I'm Sam. Have you got a moment?", expectedSequence: 2, idempotencyKey: key() }, new Date(t0.getTime() + 10_000), { scriptedReply: false });
  assert.ok(x.pausedAt);
  E.commitResidentTurn(s, x.id, { utterance: 'Quickly, then.', endConversation: false }, 'generated', new Date(t0.getTime() + 25_000));
  assert.equal(x.pausedSeconds, 15);
  assert.equal(new Date(x.deadlineAt!).getTime(), deadline0 + 15_000);
  E.endSession(s, x.id, { idempotencyKey: key() }, new Date(t0.getTime() + 40_000));
  assert.equal(x.usedSeconds, 25, '40 s wall time − 15 s paused');
});

test('customer prompt v3 keeps its safety rules and adds realism and pacing', () => {
  assert.equal(RESIDENT_PROMPT_VERSION, 'resident-v3');
  for (const must of ['untrusted dialogue', 'firm refusal', 'Do not invent facts about', 'REPLIES_LEFT', 'text-to-speech', 'Warm up', 'Cool down', 'Never agree']) {
    assert.ok(RESIDENT_SYSTEM_PROMPT.includes(must), `prompt mentions: ${must}`);
  }
});
