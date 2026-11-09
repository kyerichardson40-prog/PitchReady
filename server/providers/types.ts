import type { CampaignPack, DrillKey, EvaluationResult, RubricVersion, Scenario, ScenarioKey } from '../../lib/domain/types.ts';
import type { TranscriptTurn } from '../../lib/domain/transcript.ts';

export interface ProviderUsage {
  provider: 'anthropic' | 'deepgram' | 'mock';
  model: string | null;
  requestId: string | null;
  inputTokens?: number;
  outputTokens?: number;
  audioSeconds?: number;
  characters?: number;
  /** Never fabricate: 'unknown' when the provider did not report usage. */
  costStatus: 'reconciled' | 'unknown';
  actualCostMinor: number | null;
}

/** failed = provider answered with an error (safe to retry later); uncertain = may have been accepted (do not blindly retry). */
export class ProviderError extends Error {
  kind: 'failed' | 'uncertain'; code: string; usage: ProviderUsage | null;
  constructor(kind: 'failed' | 'uncertain', code: string, message: string, usage: ProviderUsage | null = null) {
    super(message); this.kind = kind; this.code = code; this.usage = usage;
  }
}

export interface ResidentContext {
  scenario: Pick<Scenario, 'key' | 'persona' | 'opener' | 'objection' | 'goal' | 'allowedEnding' | 'behaviour'>;
  drillKey: DrillKey | null;
  campaign: CampaignPack;
  transcript: TranscriptTurn[];
  /** How many replies the rep has left in this session (lets the customer pace towards an ending). */
  repliesLeft?: number;
  operationId: string;
}

export interface EvaluationContext {
  scenarioKey: ScenarioKey;
  drillKey: DrillKey | null;
  scenario: Record<string, unknown>;
  campaign: CampaignPack;
  rubric: Pick<RubricVersion, 'version' | 'promptVersion' | 'dimensions'>;
  transcript: TranscriptTurn[];
  transcriptRevision: number;
  operationId: string;
  repair?: { previousOutput: unknown; errors: string[] };
}

export interface SpeechToText {
  readonly model: string;
  transcribe(input: { audio: Uint8Array; mimeType: string; operationId: string }): Promise<{ text: string; durationSeconds?: number; usage: ProviderUsage }>;
}
export interface ResidentModel {
  readonly model: string;
  reply(input: ResidentContext): Promise<{ utterance: string; endConversation: boolean; reason: string | null; usage: ProviderUsage }>;
}
export interface TextToSpeech {
  readonly model: string;
  speak(input: { text: string; operationId: string }): Promise<{ audio: Uint8Array; mimeType: string; usage: ProviderUsage }>;
}
export interface Evaluator {
  readonly model: string;
  readonly kind: 'mock' | 'anthropic';
  evaluate(input: EvaluationContext): Promise<{ result: unknown; usage: ProviderUsage }>;
}
export type { EvaluationResult };
