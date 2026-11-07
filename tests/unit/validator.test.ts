import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEvaluation } from '../../lib/domain/evaluation-validator.ts';
import { FICTIONAL_CAMPAIGN } from '../../lib/content/campaign.ts';
import type { TranscriptTurn } from '../../lib/domain/transcript.ts';

const transcript: TranscriptTurn[] = [
  { id: 'resident-1', speaker: 'resident', text: 'No thank you. Please leave.', corrected: false },
  { id: 'rep-1', speaker: 'rep', text: "Of course. Thanks for your time; I'll leave you to it.", corrected: false },
];
const ctx = { transcript, transcriptRevision: 1, rubricVersion: 'demo-1', approvedFacts: FICTIONAL_CAMPAIGN.approved_facts, mustSayIds: ['M1', 'M2'], scenarioKey: 'firm-refusal' };
const nullDim = (key: string) => ({ key, score: null, reason: 'Not observed.', evidence: [] });
const good = () => ({
  schema_version: '1.1', rubric_version: 'demo-1', transcript_revision: 1,
  dimensions: [
    nullDim('introduction'), nullDim('accuracy'), nullDim('listening'), nullDim('next_step'),
    { key: 'respect', score: 5, reason: 'Ended immediately after the refusal.', evidence: [{ turn_id: 'resident-1', quote: 'No thank you. Please leave.' }, { turn_id: 'rep-1', quote: "Of course. Thanks for your time; I'll leave you to it." }] },
  ],
  strength: { text: "You accepted the resident's boundary promptly.", turn_ids: ['rep-1'] },
  improvement: null, concerns: [],
  required_statements: [{ id: 'M1', said: false, evidence: [] }, { id: 'M2', said: false, evidence: [] }],
  retry: { objective: 'Practise the same courteous ending in one sentence.', scenario_key: 'firm-refusal', drill_key: null, max_seconds: 60 },
  limitations: ['Only a short ending was observed.'],
});

test('accepts the pack example contract', () => {
  const v = validateEvaluation(good(), ctx);
  assert.equal(v.ok, true, v.ok ? '' : v.errors.join(';'));
});

test('rejects paraphrased quotes', () => {
  const g = good(); (g.dimensions[4] as any).evidence[1].quote = 'Thanks for your time, I will leave you to it.';
  assert.equal(validateEvaluation(g, ctx).ok, false);
});

test('rejects missing or duplicate dimensions', () => {
  const g = good(); g.dimensions[0] = nullDim('respect') as any;
  const v = validateEvaluation(g, ctx);
  assert.equal(v.ok, false);
});

test('rejects non-null score without evidence and absent turn IDs', () => {
  const g = good(); (g.dimensions[1] as any).score = 3;
  assert.equal(validateEvaluation(g, ctx).ok, false);
  const h = good(); (h.strength as any).turn_ids = ['rep-9'];
  assert.equal(validateEvaluation(h, ctx).ok, false);
});

test('rejects concern without rep evidence, unknown fact, wrong revision, extra keys', () => {
  const g = good(); (g.concerns as any).push({ type: 'ignored_stop_request', explanation: 'x', evidence: [{ turn_id: 'resident-1', quote: 'Please leave.' }], contradicted_fact_id: null });
  assert.equal(validateEvaluation(g, ctx).ok, false);
  const h = good(); (h.concerns as any).push({ type: 'unsupported_campaign_claim', explanation: 'x', evidence: [{ turn_id: 'rep-1', quote: 'Of course.' }], contradicted_fact_id: 'F99' });
  assert.equal(validateEvaluation(h, ctx).ok, false);
  const i = good(); i.transcript_revision = 2;
  assert.equal(validateEvaluation(i, ctx).ok, false);
  const j: any = good(); j.overall = 5;
  assert.equal(validateEvaluation(j, ctx).ok, false);
});

test('rejects freeform text and scores out of range', () => {
  assert.equal(validateEvaluation('Great job, 5/5!', ctx).ok, false);
  const g = good(); (g.dimensions[4] as any).score = 6;
  assert.equal(validateEvaluation(g, ctx).ok, false);
});
