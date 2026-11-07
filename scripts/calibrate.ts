/**
 * Calibration report: runs the 20 fictional fixtures through an evaluator and reports
 * schema validation, evidence matching and expected-flag agreement.
 *
 *   node scripts/calibrate.ts                      # deterministic demo rules (no network, no cost)
 *   node scripts/calibrate.ts --evaluator anthropic --i-accept-provider-cost
 *                                                  # live model; needs .env live AI config; costs money
 *   add --strict to exit non-zero on any expectation mismatch.
 *
 * Exact numeric scores are never a pass condition. Agreement here is NOT proof of reliability:
 * a manager must still review usefulness (build pack sections 9–10).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { FICTIONAL_CAMPAIGN } from '../lib/content/campaign.ts';
import { DEMO_RUBRIC } from '../lib/content/rubric.ts';
import { getScenario } from '../lib/content/scenarios.ts';
import { demoEvaluate } from '../lib/demo/evaluator.ts';
import { validateEvaluation, validationContext } from '../lib/domain/evaluation-validator.ts';
import { transcriptAtRevision } from '../lib/domain/transcript.ts';
import type { EvaluationResult, ScenarioKey, Turn, TurnCorrection } from '../lib/domain/types.ts';
import { getConfig } from '../server/config.ts';
import { loadDotEnv } from '../server/dotenv.ts';

interface Fixture {
  case: string; scenario_key: ScenarioKey; complete: boolean; expected_concerns: string[]; observed: string[]; not_observed: string[];
  human_review_note: string; turns: { id: string; speaker: 'rep' | 'resident'; text: string }[];
  corrections?: { turnId: string; revision: number; correctedText: string }[]; expected_concerns_revision_1?: string[];
}

const args = process.argv.slice(2);
const evaluatorKind = args.includes('--evaluator') ? args[args.indexOf('--evaluator') + 1] : 'demo';
const strict = args.includes('--strict');

loadDotEnv();
let evaluate: (f: Fixture, revision: number, transcript: ReturnType<typeof transcriptAtRevision>) => Promise<{ result: unknown; model: string }>;
if (evaluatorKind === 'anthropic') {
  if (!args.includes('--i-accept-provider-cost')) { console.error('Live calibration calls a paid API. Re-run with --i-accept-provider-cost.'); process.exit(2); }
  const cfg = getConfig();
  if (!cfg.liveAi) { console.error('Live AI is not configured:\n - ' + cfg.problems.join('\n - ')); process.exit(2); }
  const { AnthropicEvaluator } = await import('../server/providers/anthropic.ts');
  const { RateCard } = await import('../server/providers/rate-card.ts');
  const ev = new AnthropicEvaluator(cfg.env.ANTHROPIC_API_KEY!, cfg.env.ANTHROPIC_EVALUATION_MODEL!, RateCard.load(cfg.env.PROVIDER_RATE_CARD_PATH!));
  evaluate = async (f, revision, transcript) => {
    const out = await ev.evaluate({ scenarioKey: f.scenario_key, drillKey: null, scenario: getScenario(f.scenario_key) as unknown as Record<string, unknown>, campaign: FICTIONAL_CAMPAIGN, rubric: DEMO_RUBRIC, transcript, transcriptRevision: revision, operationId: `calibration:${f.case}:${revision}` });
    return { result: out.result, model: out.usage.model ?? ev.model };
  };
} else if (evaluatorKind === 'demo') {
  evaluate = async (f, revision, transcript) => ({ result: demoEvaluate({ transcript, transcriptRevision: revision, rubric: DEMO_RUBRIC, scenarioKey: f.scenario_key, drillKey: null, mustSay: FICTIONAL_CAMPAIGN.must_say, neverSay: FICTIONAL_CAMPAIGN.never_say }), model: 'demo-rules-1' });
} else { console.error('Unknown --evaluator (demo|anthropic)'); process.exit(2); }

const { fixtures } = JSON.parse(readFileSync('fixtures/calibration/fixtures.json', 'utf8')) as { fixtures: Fixture[] };
const rows: Record<string, unknown>[] = [];
let schemaFailures = 0, mismatches = 0;

for (const f of fixtures) {
  const turns: Turn[] = f.turns.map((t, i) => ({ ...t, sequence: i + 1, source: 'typed', createdAt: '' }));
  const corrections: TurnCorrection[] = (f.corrections ?? []).map((c) => ({ ...c, correctedBy: 'calibration', createdAt: '' }));
  const revisions = corrections.length ? [1, Math.max(...corrections.map((c) => c.revision))] : [1];
  for (const revision of revisions) {
    const transcript = transcriptAtRevision(turns, corrections, revision);
    let raw: unknown, model = '', error: string | null = null;
    try { ({ result: raw, model } = await evaluate(f, revision, transcript)); } catch (e) { error = (e as Error).message; }
    const v = raw === undefined ? { ok: false as const, errors: [error ?? 'no output'] } : validateEvaluation(raw, validationContext({ transcript, transcriptRevision: revision, rubricVersion: DEMO_RUBRIC.version, pack: FICTIONAL_CAMPAIGN, scenarioKey: f.scenario_key }));
    if (!v.ok) schemaFailures++;
    const r = v.ok ? (v.result as EvaluationResult) : null;
    const expected = revision === 1 && f.expected_concerns_revision_1 ? f.expected_concerns_revision_1 : f.expected_concerns;
    const got: string[] = r ? [...new Set(r.concerns.map((c): string => c.type))].sort() : [];
    const want = [...new Set(expected)].sort();
    const missing = want.filter((x) => !got.includes(x));
    const unexpected = got.filter((x) => !want.includes(x));
    const score = (k: string) => r?.dimensions.find((d) => d.key === k)?.score;
    const observedWrong = r ? f.observed.filter((k) => score(k) === null || score(k) === undefined) : [];
    const notObservedWrong = r ? f.not_observed.filter((k) => score(k) !== null) : [];
    const injectionFive = r && /injection|ignore|system/i.test(f.case) ? r.dimensions.filter((d) => d.score === 5).map((d) => d.key) : [];
    const ok = v.ok && !missing.length && !unexpected.length && !observedWrong.length && !notObservedWrong.length && !injectionFive.length;
    if (!ok) mismatches++;
    rows.push({ case: f.case, revision, model, schema_valid: v.ok, validation_errors: v.ok ? [] : v.errors.slice(0, 5), expected_concerns: want, produced_concerns: got, missing, unexpected, observed_but_null: observedWrong, not_observed_but_scored: notObservedWrong, injection_scored_five: injectionFive, agreement: ok, human_review_note: f.human_review_note });
  }
}

const report = {
  generated_at: new Date().toISOString(), evaluator: evaluatorKind, fixtures: fixtures.length, evaluations: rows.length,
  schema_failures: schemaFailures, expectation_mismatches: mismatches,
  caveat: 'Agreement with declared expectations on 20 fictional fixtures is a release check, not proof of general reliability. Manager review of usefulness is still required.',
  rows,
};
mkdirSync('reports', { recursive: true });
const path = `reports/calibration-${evaluatorKind}-${report.generated_at.replace(/[:.]/g, '-')}.json`;
writeFileSync(path, JSON.stringify(report, null, 2));
console.log(`Calibration (${evaluatorKind}): ${rows.length} evaluations over ${fixtures.length} fixtures · schema failures ${schemaFailures} · expectation mismatches ${mismatches}`);
for (const r of rows) {
  const x = r as any;
  console.log(`${x.agreement ? 'PASS' : 'DIFF'}  ${x.case} r${x.revision}  concerns got=[${x.produced_concerns}] want=[${x.expected_concerns}]${x.observed_but_null.length ? ` observed_but_null=[${x.observed_but_null}]` : ''}${x.not_observed_but_scored.length ? ` not_observed_but_scored=[${x.not_observed_but_scored}]` : ''}${x.schema_valid ? '' : ' SCHEMA:' + x.validation_errors.join('; ')}`);
}
console.log(`Report written to ${path}`);
if (schemaFailures || (strict && mismatches)) process.exit(1);
