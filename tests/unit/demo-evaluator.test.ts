import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoEvaluate } from '../../lib/demo/evaluator.ts';
import { validateEvaluation, validationContext } from '../../lib/domain/evaluation-validator.ts';
import { DEMO_RUBRIC } from '../../lib/content/rubric.ts';
import { FICTIONAL_CAMPAIGN } from '../../lib/content/campaign.ts';
import type { TranscriptTurn } from '../../lib/domain/transcript.ts';
import type { ScenarioKey } from '../../lib/domain/types.ts';

const T = (turns: [string, string][]): TranscriptTurn[] => turns.map(([id, text]) => ({ id, speaker: id.startsWith('rep') ? 'rep' : 'resident', text, corrected: false }));

function run(turns: TranscriptTurn[], scenarioKey: ScenarioKey) {
  const result = demoEvaluate({ transcript: turns, transcriptRevision: 1, rubric: DEMO_RUBRIC, scenarioKey, drillKey: null, mustSay: FICTIONAL_CAMPAIGN.must_say, neverSay: FICTIONAL_CAMPAIGN.never_say });
  const v = validateEvaluation(result, validationContext({ transcript: turns, transcriptRevision: 1, rubricVersion: DEMO_RUBRIC.version, pack: FICTIONAL_CAMPAIGN, scenarioKey }));
  assert.equal(v.ok, true, v.ok ? '' : v.errors.join('\n'));
  return result;
}
const score = (r: ReturnType<typeof run>, k: string) => r.dimensions.find((d) => d.key === k)!.score;

test('respectful ending: no concerns, respect 5, accuracy not observed', () => {
  const r = run(T([['resident-1', 'No thank you. Please leave.'], ['rep-1', "Of course. Thanks for your time; I'll leave you to it."]]), 'firm-refusal');
  assert.deepEqual(r.concerns, []);
  assert.equal(score(r, 'respect'), 5);
  assert.equal(score(r, 'accuracy'), null);
  assert.equal(score(r, 'introduction'), null);
  assert.ok(r.strength);
});

test('unsupported claim is flagged with exact evidence', () => {
  const r = run(T([['resident-1', 'How much reaches the project?'], ['rep-1', 'One hundred percent of every donation goes straight to the people who need it.']]), 'sceptical');
  assert.deepEqual(r.concerns.map((c) => c.type), ['unsupported_campaign_claim']);
  assert.equal(score(r, 'accuracy'), 1);
});

test('ignored refusal is flagged', () => {
  const r = run(T([['resident-1', 'No thank you. Please leave.'], ['rep-1', 'But surely you can spare ten pounds. Let me finish the pitch first.']]), 'firm-refusal');
  assert.ok(r.concerns.some((c) => c.type === 'ignored_stop_request'));
  assert.equal(score(r, 'respect'), 1);
  assert.ok(r.improvement);
});

test('empty transcript gives not-observed everywhere', () => {
  const r = run(T([['resident-1', "I've only got a moment. What's this about?"]]), 'busy');
  assert.ok(r.dimensions.every((d) => d.score === null));
  assert.equal(r.strength, null);
  assert.equal(r.improvement, null);
});
