import { utteranceSoFar } from '../../lib/ai/stream-text.ts';
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

/**
 * Streaming version of callClaude (server-sent events). Same checks and usage accounting; calls
 * onText with the full text received so far after each piece arrives. The timeout covers the
 * whole response, not just the first byte.
 */
async function callClaudeStream(opts: Parameters<typeof callClaude>[0] & { onText: (soFar: string) => void }) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs);
  const usage: ProviderUsage = { provider: 'anthropic', model: opts.model, requestId: null, inputTokens: undefined, outputTokens: undefined, costStatus: 'unknown', actualCostMinor: null };
  let text = ''; let stop: string | null = null;
  try {
    let res: Response;
    try {
      res = await fetch(API, {
        method: 'POST', signal: ctl.signal,
        headers: { 'x-api-key': opts.apiKey, 'anthropic-version': VERSION, 'content-type': 'application/json' },
        body: JSON.stringify({ model: opts.model, max_tokens: opts.maxTokens, system: opts.system, messages: opts.messages, stream: true,
          output_config: { format: { type: 'json_schema', schema: opts.schema } } }),
      });
    } catch (e) {
      throw (e as Error)?.name === 'AbortError' ? new ProviderError('uncertain', 'anthropic_timeout', 'anthropic timed out') : new ProviderError('failed', 'anthropic_network', 'anthropic not reachable');
    }
    if (!res.ok || !res.body) {
      await res.text().catch(() => '');
      throw new ProviderError('failed', `anthropic_http_${res.status}`, `anthropic returned HTTP ${res.status}`);
    }
    usage.requestId = res.headers.get('request-id');
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); }
      catch (e) { throw (e as Error)?.name === 'AbortError' ? new ProviderError('uncertain', 'anthropic_timeout', 'anthropic timed out', usage) : new ProviderError('uncertain', 'anthropic_stream_broken', 'anthropic stream broke', usage); }
      if (chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        let ev: any;
        try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (ev.type === 'message_start') {
          usage.model = ev.message?.model ?? usage.model;
          usage.requestId ??= ev.message?.id ?? null;
          usage.inputTokens = ev.message?.usage?.input_tokens;
        } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && typeof ev.delta.text === 'string') {
          text += ev.delta.text;
          try { opts.onText(text); } catch { /* a listener problem must not break the reply */ }
        } else if (ev.type === 'message_delta') {
          stop = ev.delta?.stop_reason ?? stop;
          if (typeof ev.usage?.output_tokens === 'number') usage.outputTokens = ev.usage.output_tokens;
        } else if (ev.type === 'error') {
          throw new ProviderError('failed', 'anthropic_stream_error', 'anthropic stream error', usage);
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
  if (typeof usage.inputTokens === 'number') {
    usage.costStatus = 'reconciled';
    if (opts.rateCard) usage.actualCostMinor = opts.rateCard.anthropicCost(usage.model ?? opts.model, usage.inputTokens, usage.outputTokens ?? 0);
    else usage.costStatus = 'unknown';
  }
  if (stop === 'refusal') throw new ProviderError('failed', 'anthropic_refusal', 'Model refused', usage);
  if (stop === 'max_tokens') throw new ProviderError('failed', 'anthropic_max_tokens', 'Output truncated', usage);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ProviderError('failed', 'anthropic_bad_json', 'Output was not JSON', usage); }
  return { parsed, usage };
}

const transcriptData = (t: { id: string; speaker: string; text: string }[]) => t.map((x) => ({ turn_id: x.id, speaker: x.speaker, text: x.text }));

export class AnthropicResident implements ResidentModel {
  readonly model: string;
  private apiKey: string; private rateCard: RateCard | null;
  constructor(apiKey: string, model: string, rateCard: RateCard | null) { this.apiKey = apiKey; this.model = model; this.rateCard = rateCard; }
  async reply(input: ResidentContext) { return this.run(input, null); }
  async replyStream(input: ResidentContext, onText: (utteranceSoFar: string) => void) { return this.run(input, onText); }
  private async run(input: ResidentContext, onText: ((utteranceSoFar: string) => void) | null) {
    const data = {
      SALES_SETTING: salesSettingForAi(salesContextOf(input.campaign)),
      SCENARIO: input.scenario, DRILL: input.drillKey,
      APPROVED_CAMPAIGN: { name: input.campaign.name, organisation: input.campaign.organisation, fictional: input.campaign.fictional, approved_facts: input.campaign.approved_facts },
      REPLIES_LEFT: input.repliesLeft ?? null,
      // Whole conversation (up to 40 replies each side) so the customer remembers what was said.
      TRANSCRIPT_UNTRUSTED: transcriptData(input.transcript.slice(-90)),
      TASK: 'Reply as the customer to the latest rep turn.',
    };
    const req = { apiKey: this.apiKey, model: this.model, system: RESIDENT_SYSTEM_PROMPT, messages: [{ role: 'user' as const, content: JSON.stringify(data) }], schema: RESIDENT_JSON_SCHEMA, maxTokens: 300, timeoutMs: 20_000, rateCard: this.rateCard };
    const { parsed, usage } = onText
      ? await callClaudeStream({ ...req, onText: (soFar) => onText(utteranceSoFar(soFar)) })
      : await callClaude(req);
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
