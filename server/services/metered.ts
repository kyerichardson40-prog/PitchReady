import { getDb } from '../db.ts';
import { ApiError } from '../http.ts';
import type { Providers } from '../providers/index.ts';
import { ProviderError, type ProviderUsage } from '../providers/types.ts';

/**
 * Wraps one provider call: persists the attempt and reserves estimated spend BEFORE calling,
 * then reconciles with reported usage. A repeated operation ID never launches a second call.
 */
export async function metered<T extends { usage: ProviderUsage }>(
  p: Providers,
  op: { sessionId: string; operationId: string; operation: 'stt' | 'resident' | 'tts' | 'evaluate'; model: string; sizeHint: number; turnLabel?: string },
  call: () => Promise<T>,
): Promise<T> {
  const svc = getDb().service();
  const estimate = p.rateCard ? p.rateCard.estimate(op.operation, op.model, op.sizeHint) : 0;
  const began = await svc.rpc<{ existing: boolean; state: string }>('begin_provider_attempt', {
    session_id: op.sessionId, operation_id: op.operationId, operation: op.operation, provider: p.kind === 'mock' ? 'mock' : op.operation === 'stt' || op.operation === 'tts' ? 'deepgram' : 'anthropic',
    model: op.model, turn_label: op.turnLabel ?? null, estimated_cost_minor: estimate, currency: p.budget.currency,
    global_budget_minor: p.budget.globalMinor, agency_budget_minor: p.budget.agencyMinor,
  });
  if (began.existing) {
    // Never blindly reissue: an earlier attempt with this ID exists (possibly uncertain).
    throw new ApiError(409, began.state === 'in_flight' ? 'operation_in_progress' : 'operation_already_attempted',
      began.state === 'in_flight' ? 'That step is still being processed.' : 'That step was already attempted. Please try again with a new recording or reply.');
  }
  try {
    const out = await call();
    await svc.rpc('finish_provider_attempt', {
      operation_id: op.operationId, state: 'succeeded', provider_request_id: out.usage.requestId,
      units: { input_tokens: out.usage.inputTokens, output_tokens: out.usage.outputTokens, audio_seconds: out.usage.audioSeconds, characters: out.usage.characters },
      actual_cost_minor: out.usage.actualCostMinor, cost_status: out.usage.costStatus === 'reconciled' && out.usage.actualCostMinor !== null ? 'reconciled' : 'unknown',
    });
    return out;
  } catch (e) {
    const pe = e instanceof ProviderError ? e : new ProviderError('uncertain', 'unexpected_error', 'Unexpected provider error');
    await svc.rpc('finish_provider_attempt', {
      operation_id: op.operationId, state: pe.kind, error_code: pe.code, provider_request_id: pe.usage?.requestId ?? null,
      actual_cost_minor: pe.usage?.actualCostMinor ?? null, cost_status: pe.usage?.actualCostMinor != null ? 'reconciled' : 'unknown',
    }).catch(() => undefined);
    throw pe;
  }
}
