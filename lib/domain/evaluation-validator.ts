import { evaluationResultSchema } from './schemas.ts';
import type { ApprovedFact, EvaluationResult } from './types.ts';
import { DIMENSION_KEYS } from './types.ts';
import { getDrill } from '../content/scenarios.ts';
import type { TranscriptTurn } from './transcript.ts';

export interface ValidationContext {
  transcript: TranscriptTurn[];
  transcriptRevision: number;
  rubricVersion: string;
  approvedFacts: ApprovedFact[];
  /** IDs of the campaign's must-say items: required_statements must cover each exactly once. */
  mustSayIds: string[];
  /** The session's scenario: the suggested retry must practise it (or one of its drills). */
  scenarioKey: string;
}

/** Builds the validation context from the frozen campaign pack and session. */
export function validationContext(input: { transcript: TranscriptTurn[]; transcriptRevision: number; rubricVersion: string; pack: { approved_facts: ApprovedFact[]; must_say?: { id: string }[] }; scenarioKey: string }): ValidationContext {
  return {
    transcript: input.transcript, transcriptRevision: input.transcriptRevision, rubricVersion: input.rubricVersion,
    approvedFacts: input.pack.approved_facts, mustSayIds: (input.pack.must_say ?? []).map((m) => m.id), scenarioKey: input.scenarioKey,
  };
}

export type ValidationOutcome =
  | { ok: true; result: EvaluationResult }
  | { ok: false; errors: string[] };

/**
 * Validates evaluator output: structure first, then evidence semantics.
 * Passing this check means the output is well-formed and its quotes are real — not that the
 * judgement is right. Semantic accuracy is checked by calibration and human review.
 */
export function validateEvaluation(raw: unknown, ctx: ValidationContext): ValidationOutcome {
  const parsed = evaluationResultSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
  }
  const result = parsed.data as EvaluationResult;
  const errors: string[] = [];
  const turns = new Map(ctx.transcript.map((t) => [t.id, t]));
  const repIds = new Set(ctx.transcript.filter((t) => t.speaker === 'rep' && t.text.trim()).map((t) => t.id));
  const factIds = new Set(ctx.approvedFacts.map((f) => f.id));

  if (result.rubric_version !== ctx.rubricVersion) errors.push(`rubric_version must be ${ctx.rubricVersion}`);
  if (result.transcript_revision !== ctx.transcriptRevision) errors.push(`transcript_revision must be ${ctx.transcriptRevision}`);

  const seen = new Set<string>();
  for (const d of result.dimensions) {
    if (seen.has(d.key)) errors.push(`dimension ${d.key} appears more than once`);
    seen.add(d.key);
  }
  for (const k of DIMENSION_KEYS) if (!seen.has(k)) errors.push(`dimension ${k} is missing`);

  const checkEvidence = (path: string, ev: { turn_id: string; quote: string }[]) => {
    ev.forEach((e, i) => {
      const t = turns.get(e.turn_id);
      if (!t) { errors.push(`${path}[${i}]: turn ${e.turn_id} does not exist`); return; }
      if (!e.quote.trim() || !t.text.includes(e.quote)) errors.push(`${path}[${i}]: quote is not an exact excerpt of ${e.turn_id}`);
    });
  };

  for (const d of result.dimensions) {
    checkEvidence(`dimensions.${d.key}.evidence`, d.evidence);
    if (d.score !== null) {
      if (d.evidence.length === 0) errors.push(`dimensions.${d.key}: non-null score needs evidence`);
      else if (!d.evidence.some((e) => repIds.has(e.turn_id))) errors.push(`dimensions.${d.key}: score needs evidence from a rep turn`);
    }
  }

  for (const [name, p] of [['strength', result.strength], ['improvement', result.improvement]] as const) {
    if (!p) continue;
    for (const id of p.turn_ids) {
      if (!turns.has(id)) errors.push(`${name}: turn ${id} does not exist`);
    }
    if (!p.turn_ids.some((id) => repIds.has(id))) errors.push(`${name}: must reference at least one rep turn`);
  }

  result.concerns.forEach((c, i) => {
    checkEvidence(`concerns[${i}].evidence`, c.evidence);
    if (!c.evidence.some((e) => repIds.has(e.turn_id))) errors.push(`concerns[${i}]: needs supporting rep evidence`);
    if (c.contradicted_fact_id && !factIds.has(c.contradicted_fact_id)) errors.push(`concerns[${i}]: unknown fact ${c.contradicted_fact_id}`);
  });

  const reqs = result.required_statements ?? [];
  const reqIds = reqs.map((r) => r.id);
  if (new Set(reqIds).size !== reqIds.length) errors.push('required_statements: each must-say item at most once');
  for (const id of ctx.mustSayIds) if (!reqIds.includes(id)) errors.push(`required_statements: ${id} is missing`);
  for (const id of reqIds) if (!ctx.mustSayIds.includes(id)) errors.push(`required_statements: ${id} is not a must-say item`);
  reqs.forEach((r) => {
    checkEvidence(`required_statements.${r.id}.evidence`, r.evidence);
    if (r.said && !r.evidence.some((e) => repIds.has(e.turn_id))) errors.push(`required_statements.${r.id}: "said" needs a quote from a rep turn`);
    if (!r.said && r.evidence.length) errors.push(`required_statements.${r.id}: "not said" must have no evidence`);
  });
  result.concerns.forEach((c, i) => {
    if (c.type === 'banned_phrase' && c.contradicted_fact_id) errors.push(`concerns[${i}]: banned_phrase has no contradicted fact`);
  });

  // Retry: one of the built-in 60-second drills (with its own base scenario), or the same scenario again.
  if (result.retry.drill_key) {
    if (getDrill(result.retry.drill_key)?.baseScenario !== result.retry.scenario_key) errors.push(`retry.scenario_key must be the base scenario of drill ${result.retry.drill_key}`);
  } else if (result.retry.scenario_key !== ctx.scenarioKey) errors.push(`retry.scenario_key must be ${ctx.scenarioKey} when there is no drill`);

  if (repIds.size === 0) {
    if (result.dimensions.some((d) => d.score !== null)) errors.push('blank transcript: every score must be null (not observed)');
    if (result.strength || result.improvement) errors.push('blank transcript: strength and improvement must be null');
    if (result.concerns.length) errors.push('blank transcript: concerns must be empty');
    if (reqs.some((r) => r.said)) errors.push('blank transcript: nothing can have been said');
  }

  return errors.length ? { ok: false, errors } : { ok: true, result };
}
