import { validateEvaluation, validationContext } from '../../lib/domain/evaluation-validator.ts';
import { demoEvaluate } from '../../lib/demo/evaluator.ts';
import { isGarbled } from '../../lib/demo/patterns.ts';
import { EVALUATOR_PROMPT_VERSION } from '../../lib/ai/prompts.ts';
import type { CampaignPack, DrillKey, RubricDimension, ScenarioKey } from '../../lib/domain/types.ts';
import type { TranscriptTurn } from '../../lib/domain/transcript.ts';
import { getDb } from '../db.ts';
import { getProviders } from '../providers/index.ts';
import { ProviderError } from '../providers/types.ts';
import { metered } from './metered.ts';

interface Job {
  session_id: string; agency_id: string; transcript_revision: number; attempt: number;
  scenario_key: ScenarioKey; drill_key: DrillKey | null; scenario: Record<string, unknown>;
  campaign: CampaignPack; rubric: { version: string; prompt_version: string; dimensions: RubricDimension[] };
  transcript: { id: string; speaker: 'rep' | 'resident'; text: string; corrected: boolean }[];
}

export type EvalOutcome = 'completed' | 'unavailable' | 'deferred' | 'none';

/**
 * Claims one durable evaluation job (optionally for a given session), runs the evaluator, validates
 * structure + evidence, allows ONE bounded repair, and stores either a validated result or an
 * "unavailable" record. Invalid output is never stored as a success.
 */
export async function runEvaluationJob(sessionId?: string): Promise<EvalOutcome> {
  const providers = getProviders();
  if (!providers) return 'none';
  const svc = getDb().service();
  const job = await svc.rpc<Job | null>('claim_evaluation_job', { session_id: sessionId ?? null, lease_seconds: 90 });
  if (!job) return 'none';
  const transcript: TranscriptTurn[] = job.transcript.map((t) => ({ id: t.id, speaker: t.speaker, text: t.text, corrected: t.corrected }));
  const ctx = validationContext({ transcript, transcriptRevision: job.transcript_revision, rubricVersion: job.rubric.version, pack: job.campaign, scenarioKey: job.scenario_key });
  const save = (status: 'completed' | 'unavailable', result: unknown, model: string, errors?: string[]) =>
    svc.rpc<{ status: string }>('save_evaluation', {
      session_id: job.session_id, transcript_revision: job.transcript_revision, status, result: status === 'completed' ? result : null,
      evaluator_kind: providers.evaluator.kind, model, prompt_version: job.rubric.prompt_version ?? EVALUATOR_PROMPT_VERSION, errors: errors ?? null,
    });

  // No usable rep speech → deterministic insufficient-evidence result; no model call, no invented scores.
  if (!transcript.some((t) => t.speaker === 'rep' && !isGarbled(t.text))) {
    const r = demoEvaluate({ transcript, transcriptRevision: job.transcript_revision, rubric: { version: job.rubric.version, promptVersion: job.rubric.prompt_version, dimensions: job.rubric.dimensions, approvedAt: null, approvedBy: null }, scenarioKey: job.scenario_key, drillKey: job.drill_key, mustSay: job.campaign.must_say, neverSay: job.campaign.never_say });
    r.limitations = ['No usable rep speech was recorded, so nothing could be assessed.'];
    const v = validateEvaluation(r, ctx);
    const saved = await save(v.ok ? 'completed' : 'unavailable', r, 'rules:insufficient-evidence', v.ok ? undefined : v.errors);
    return saved.status as EvalOutcome;
  }

  const input = {
    scenarioKey: job.scenario_key, drillKey: job.drill_key, scenario: job.scenario, campaign: job.campaign,
    rubric: { version: job.rubric.version, promptVersion: job.rubric.prompt_version, dimensions: job.rubric.dimensions },
    transcript, transcriptRevision: job.transcript_revision,
  };
  const size = JSON.stringify(input).length;
  const opBase = `eval:${job.session_id}:${job.transcript_revision}:${job.attempt}`;
  try {
    const first = await metered(providers, { sessionId: job.session_id, operationId: opBase, operation: 'evaluate', model: providers.evaluator.model, sizeHint: size },
      () => providers.evaluator.evaluate({ ...input, operationId: opBase }));
    let v = validateEvaluation(first.result, ctx);
    let model = first.usage.model ?? providers.evaluator.model;
    if (!v.ok) {
      const errors = v.errors;
      const repaired = await metered(providers, { sessionId: job.session_id, operationId: `${opBase}:repair`, operation: 'evaluate', model: providers.evaluator.model, sizeHint: size * 2 },
        () => providers.evaluator.evaluate({ ...input, operationId: `${opBase}:repair`, repair: { previousOutput: first.result, errors } }));
      v = validateEvaluation(repaired.result, ctx);
      model = repaired.usage.model ?? model;
      if (!v.ok) {
        const saved = await save('unavailable', null, model, v.errors);
        return saved.status as EvalOutcome;
      }
    }
    const saved = await save('completed', v.result, model);
    return saved.status as EvalOutcome; // DB re-checks evidence and may still mark unavailable
  } catch (e) {
    const code = e instanceof ProviderError ? e.code : (e as { code?: string })?.code ?? 'evaluation_error';
    await svc.rpc('defer_evaluation_job', { session_id: job.session_id, transcript_revision: job.transcript_revision, error_code: String(code).slice(0, 60) }).catch(() => undefined);
    return 'deferred';
  }
}
