/**
 * LABELLED MOCK providers for tests and CI (AI_PROVIDER=mock; refused in production).
 * They reuse the deterministic demo rules. Evaluations are stored with evaluator_kind = 'mock' and
 * shown in the UI as "Mock feedback (test provider — not AI)".
 * Failure injection for recovery tests: MOCK_PROVIDER_FAIL=stt|resident|tts|evaluate|evaluate-invalid,
 * MOCK_PROVIDER_MODE=failed|uncertain.
 */
import { demoEvaluate } from '../../lib/demo/evaluator.ts';
import { demoResidentReply } from '../../lib/demo/resident.ts';
import type { RubricVersion } from '../../lib/domain/types.ts';
import { ProviderError, type EvaluationContext, type Evaluator, type ProviderUsage, type ResidentContext, type ResidentModel, type SpeechToText, type TextToSpeech } from './types.ts';

const usage = (extra: Partial<ProviderUsage> = {}): ProviderUsage => ({ provider: 'mock', model: 'mock', requestId: `mock-${Date.now()}`, costStatus: 'reconciled', actualCostMinor: 0, ...extra });
function maybeFail(op: string) {
  if ((process.env.MOCK_PROVIDER_FAIL ?? '').split(',').includes(op)) {
    const kind = process.env.MOCK_PROVIDER_MODE === 'uncertain' ? 'uncertain' : 'failed';
    throw new ProviderError(kind, `mock_${op}_${kind}`, `Injected mock ${op} ${kind}`);
  }
}

export class MockSTT implements SpeechToText {
  readonly model = 'mock-stt';
  async transcribe(input: { audio: Uint8Array; mimeType: string }) {
    maybeFail('stt');
    const head = new TextDecoder().decode(input.audio.slice(0, 600));
    // Tests send "MOCK-TRANSCRIPT:<text>" as the audio payload. Anything else yields an explicit placeholder.
    const text = head.startsWith('MOCK-TRANSCRIPT:') ? head.slice('MOCK-TRANSCRIPT:'.length).trim() : '[mock transcription of recorded audio]';
    return { text, durationSeconds: 3, usage: usage({ audioSeconds: 3 }) };
  }
}

export class MockResident implements ResidentModel {
  readonly model = 'mock-resident';
  async reply(input: ResidentContext) {
    maybeFail('resident');
    const r = demoResidentReply({ scenarioKey: input.scenario.key, drillKey: input.drillKey, transcript: input.transcript });
    return { ...r, usage: usage() };
  }
}

export class MockTTS implements TextToSpeech {
  readonly model = 'mock-tts';
  async speak(input: { text: string }) {
    maybeFail('tts');
    // 0.1s of silent 8kHz mono WAV.
    const samples = 800, buf = new ArrayBuffer(44 + samples * 2), v = new DataView(buf);
    const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, samples * 2, true);
    return { audio: new Uint8Array(buf), mimeType: 'audio/wav', usage: usage({ characters: input.text.length }) };
  }
}

export class MockEvaluator implements Evaluator {
  readonly model = 'mock-evaluator'; readonly kind = 'mock' as const;
  async evaluate(input: EvaluationContext) {
    maybeFail('evaluate');
    const result = demoEvaluate({
      transcript: input.transcript, transcriptRevision: input.transcriptRevision,
      rubric: { version: input.rubric.version, promptVersion: input.rubric.promptVersion, dimensions: input.rubric.dimensions, approvedAt: null, approvedBy: null } as RubricVersion,
      scenarioKey: input.scenarioKey, drillKey: input.drillKey, mustSay: input.campaign.must_say, neverSay: input.campaign.never_say,
    });
    result.limitations = result.limitations.map((l) => l.startsWith('Demo feedback') ? 'Mock feedback from a test provider (rule-based, not AI).' : l);
    if ((process.env.MOCK_PROVIDER_FAIL ?? '').split(',').includes('evaluate-invalid') && !input.repair) {
      // Invalid first output (paraphrased quote) to exercise the bounded repair path.
      const d = result.dimensions.find((x) => x.evidence.length);
      if (d) d.evidence[0] = { ...d.evidence[0]!, quote: 'a paraphrase that is not in the transcript' };
    }
    return { result, usage: usage() };
  }
}
