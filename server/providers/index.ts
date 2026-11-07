import { getConfig } from '../config.ts';
import { AnthropicEvaluator, AnthropicResident } from './anthropic.ts';
import { DeepgramSTT, DeepgramTTS } from './deepgram.ts';
import { MockEvaluator, MockResident, MockSTT, MockTTS } from './mock.ts';
import { RateCard } from './rate-card.ts';
import type { Evaluator, ResidentModel, SpeechToText, TextToSpeech } from './types.ts';

export interface Providers {
  kind: 'anthropic' | 'mock';
  resident: ResidentModel;
  evaluator: Evaluator;
  stt: SpeechToText | null;
  tts: TextToSpeech | null;
  rateCard: RateCard | null;
  budget: { globalMinor: number; agencyMinor: number; currency: string };
}

let cached: Providers | null | undefined;

/** Returns null when live AI is not fully configured — callers fail closed with setup guidance. */
export function getProviders(): Providers | null {
  if (cached !== undefined) return cached;
  const cfg = getConfig();
  const env = cfg.env;
  if (cfg.providerKind === 'mock') {
    cached = { kind: 'mock', resident: new MockResident(), evaluator: new MockEvaluator(), stt: new MockSTT(), tts: new MockTTS(), rateCard: null,
      budget: { globalMinor: env.AI_GLOBAL_BUDGET_MINOR_UNITS ?? 1_000_000, agencyMinor: env.AI_AGENCY_BUDGET_MINOR_UNITS ?? 1_000_000, currency: env.AI_BUDGET_CURRENCY ?? 'GBP' } };
    return cached;
  }
  if (cfg.providerKind !== 'anthropic') { cached = null; return null; }
  const rateCard = RateCard.load(env.PROVIDER_RATE_CARD_PATH!);
  if (rateCard.currency !== env.AI_BUDGET_CURRENCY) throw new Error('Rate card currency must match AI_BUDGET_CURRENCY.');
  // Fail at startup if the configured models have no price (prevents unbudgeted calls).
  rateCard.anthropicCost(env.ANTHROPIC_ROLEPLAY_MODEL!, 1, 1);
  rateCard.anthropicCost(env.ANTHROPIC_EVALUATION_MODEL!, 1, 1);
  const stt = cfg.voice.stt ? (rateCard.sttCost(env.DEEPGRAM_STT_MODEL!, 1), new DeepgramSTT(env.DEEPGRAM_API_KEY!, env.DEEPGRAM_STT_MODEL!, rateCard)) : null;
  const tts = cfg.voice.tts ? (rateCard.ttsCost(env.DEEPGRAM_TTS_MODEL!, 1), new DeepgramTTS(env.DEEPGRAM_API_KEY!, env.DEEPGRAM_TTS_MODEL!, rateCard)) : null;
  cached = {
    kind: 'anthropic',
    resident: new AnthropicResident(env.ANTHROPIC_API_KEY!, env.ANTHROPIC_ROLEPLAY_MODEL!, rateCard),
    evaluator: new AnthropicEvaluator(env.ANTHROPIC_API_KEY!, env.ANTHROPIC_EVALUATION_MODEL!, rateCard),
    stt, tts, rateCard,
    budget: { globalMinor: env.AI_GLOBAL_BUDGET_MINOR_UNITS!, agencyMinor: env.AI_AGENCY_BUDGET_MINOR_UNITS!, currency: env.AI_BUDGET_CURRENCY! },
  };
  return cached;
}

export function resetProvidersForTests() { cached = undefined; }
