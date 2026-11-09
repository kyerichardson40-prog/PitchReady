/**
 * Anthropic Messages API adapter (server-only), using structured outputs via
 * `output_config.format = { type: 'json_schema', schema }` — the current, non-beta parameter per
 * https://platform.claude.com/docs/en/build-with-claude/structured-outputs (checked 2026-11-06).
 * Model IDs come from ANTHROPIC_ROLEPLAY_MODEL / ANTHROPIC_EVALUATION_MODEL; none are hard-coded.
 * NOT verified against the live API in this build (no key available) — see TEST_REPORT.md.
 */
import { salesContextOf, salesSettingForAi } from '../../lib/domain/sales.ts';
import { EVALUATION_JSON_SCHEMA, RESIDENT_JSON_SCHEMA } from '../../lib/ai/json-schemas.ts';
import { EVALUATOR_SYSTEM_PROMPT, RESIDENT_SYSTEM_PROMPT, repairInstruction } from '../../lib/ai/prompts.ts';
import { residentResultSchema } from '../../lib/domain/schemas.ts';
import { providerFetch } from './http-call.ts';
import { ProviderError, type EvaluationContext, type Evaluator, type ProviderUsage, type ResidentContext, type ResidentModel } from './types.ts';
import type { RateCard } from './rate-card.ts';

const API = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';

async function callClaude(opts: { apiKey: string; model: string; system: string; messages: { role: 'user' | 'assistant'; content: string }[]; schema: unknown; maxTokens: number; timeoutMs: number; rateCard: RateCard | null }) {
  const res = await providerFetch(API, {
    method: 'POST',
    headers: { 'x-api-key': opts.apiKey, 'anthropic-version': VERSION, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: opts.model, max_tokens: opts.maxTokens, system: opts.system, messages: opts.messages,
      output_config: { format: { type: 'json_schema', schema: opts.schema } },
    }),
  }, opts.timeoutMs, 'anthropic');
  const body: any = await res.json().catch(() => null);
  const usage: ProviderUsage = {
    provider: 'anthropic', model: body?.model ?? opts.model, requestId: res.headers.get('request-id') ?? body?.id ?? null,
    inputTokens: body?.usage?.input_tokens, outputTokens: body?.usage?.output_tokens,
    costStatus: typeof body?.usage?.input_tokens === 'number' ? 'reconciled' : 'unknown', actualCostMinor: null,
  };
  if (usage.costStatus === 'reconciled' && opts.rateCard) usage.actualCostMinor = opts.rateCard.anthropicCost(opts.model, usage.inputTokens!, usage.outputTokens ?? 0);
  if (!usage.actualCostMinor && usage.costStatus === 'reconciled' && !opts.rateCard) usage.costStatus = 'unknown';
  if (body?.stop_reason === 'refusal') throw new ProviderError('failed', 'anthropic_refusal', 'Model refused', usage);
  if (body?.stop_reason === 'max_tokens') throw new ProviderError('failed', 'anthropic_max_tokens', 'Output truncated', usage);
  const text = (body?.content ?? []).find((b: any) => b?.type === 'text')?.text;
  if (typeof text !== 'string') throw new ProviderError('failed', 'anthropic_no_text', 'No text block', usage);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ProviderError('failed', 'anthropic_bad_json', 'Output was not JSON', usage); }
  return { parsed, usage };
}

const transcriptData = (t: { id: string; speaker: string; text: string }[]) => t.map((x) => ({ turn_id: x.id, speaker: x.speaker, text: x.text }));

export class AnthropicResident implements ResidentModel {
  readonly model: string;
  private apiKey: string; private rateCard: RateCard | null;
  constructor(apiKey: string, model: string, rateCard: RateCard | null) { this.apiKey = apiKey; this.model = model; this.rateCard = rateCard; }
  async reply(input: ResidentContext) {
    const data = {
      SALES_SETTING: salesSettingForAi(salesContextOf(input.campaign)),
      SCENARIO: input.scenario, DRILL: input.drillKey,
      APPROVED_CAMPAIGN: { name: input.campaign.name, organisation: input.campaign.organisation, fictional: input.campaign.fictional, approved_facts: input.campaign.approved_facts },
      REPLIES_LEFT: input.repliesLeft ?? null,
      // Whole conversation (up to 40 replies each side) so the customer remembers what was said.
      TRANSCRIPT_UNTRUSTED: transcriptData(input.transcript.slice(-90)),
      TASK: 'Reply as the customer to the latest rep turn.',
    };
    const { parsed, usage } = await callClaude({ apiKey: this.apiKey, model: this.model, system: RESIDENT_SYSTEM_PROMPT, messages: [{ role: 'user', content: JSON.stringify(data) }], schema: RESIDENT_JSON_SCHEMA, maxTokens: 300, timeoutMs: 20_000, rateCard: this.rateCard });
    const r = residentResultSchema.safeParse(parsed);
    if (!r.success) throw new ProviderError('failed', 'resident_invalid_output', 'Resident output invalid', usage);
    return { ...r.data, usage };
  }
}

export class AnthropicEvaluator implements Evaluator {
  readonly model: string; readonly kind = 'anthropic' as const;
  private apiKey: string; private rateCard: RateCard | null;
  constructor(apiKey: string, model: string, rateCard: RateCard | null) { this.apiKey = apiKey; this.model = model; this.rateCard = rateCard; }
  async evaluate(input: EvaluationContext) {
    const data = {
      RUBRIC_VERSION: input.rubric.version, RUBRIC: input.rubric.dimensions,
      SALES_SETTING: salesSettingForAi(salesContextOf(input.campaign)),
      APPROVED_CAMPAIGN: {
        approved_facts: input.campaign.approved_facts, forbidden_claims: input.campaign.forbidden_claims, fictional: input.campaign.fictional,
        must_say: input.campaign.must_say ?? [], never_say: input.campaign.never_say ?? [], objection_answers: input.campaign.objection_answers ?? [],
      },
      SCENARIO: input.scenario, DRILL: input.drillKey,
      TRANSCRIPT_REVISION: input.transcriptRevision,
      TRANSCRIPT_UNTRUSTED: transcriptData(input.transcript),
      OUTPUT_RULES: { schema_version: '1.1', rubric_version: input.rubric.version, transcript_revision: input.transcriptRevision, retry_max_seconds: 60, text_limits: 'reason ≤ 400 chars, quotes ≤ 300 chars, ≤ 4 evidence items each' },
    };
    const messages: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: JSON.stringify(data) }];
    if (input.repair) {
      messages.push({ role: 'assistant', content: JSON.stringify(input.repair.previousOutput).slice(0, 20_000) });
      messages.push({ role: 'user', content: repairInstruction(input.repair.errors) });
    }
    const { parsed, usage } = await callClaude({ apiKey: this.apiKey, model: this.model, system: EVALUATOR_SYSTEM_PROMPT, messages, schema: EVALUATION_JSON_SCHEMA, maxTokens: 3000, timeoutMs: 45_000, rateCard: this.rateCard });
    return { result: parsed, usage };
  }
}
