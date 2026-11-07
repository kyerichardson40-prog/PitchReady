/**
 * Provider unit prices used for spend estimates. Values are supplied by the operator from current
 * provider pricing pages — none are shipped in this repository. All amounts are MINOR units of
 * `currency` (e.g. pence) and may be fractional; costs are rounded UP.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const positive = z.number().nonnegative();
const rateCardSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source_note: z.string().min(3),
  anthropic: z.record(z.object({ input_per_million_tokens_minor: positive, output_per_million_tokens_minor: positive })),
  deepgram_stt: z.record(z.object({ per_minute_minor: positive })),
  deepgram_tts: z.record(z.object({ per_thousand_characters_minor: positive })),
}).strict();

export type RateCardData = z.infer<typeof rateCardSchema>;

export class RateCard {
  readonly data: RateCardData;
  constructor(data: RateCardData) { this.data = data; }
  static load(path: string): RateCard {
    const parsed = rateCardSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    if (!parsed.success) throw new Error(`Invalid rate card at ${path}: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
    return new RateCard(parsed.data);
  }
  private need<T>(table: Record<string, T>, model: string, kind: string): T {
    const v = table[model];
    if (!v) throw new Error(`Rate card has no ${kind} price for model "${model}". Live calls stay disabled for it.`);
    return v;
  }
  anthropicCost(model: string, inTok: number, outTok: number): number {
    const r = this.need(this.data.anthropic, model, 'anthropic');
    return Math.ceil((inTok * r.input_per_million_tokens_minor + outTok * r.output_per_million_tokens_minor) / 1_000_000);
  }
  sttCost(model: string, seconds: number): number {
    return Math.ceil((seconds / 60) * this.need(this.data.deepgram_stt, model, 'STT').per_minute_minor);
  }
  ttsCost(model: string, chars: number): number {
    return Math.ceil((chars / 1000) * this.need(this.data.deepgram_tts, model, 'TTS').per_thousand_characters_minor);
  }
  /** Conservative pre-call estimates (upper bounds). */
  estimate(op: 'resident' | 'evaluate' | 'stt' | 'tts', model: string, sizeHint: number): number {
    switch (op) {
      case 'resident': return this.anthropicCost(model, Math.ceil(sizeHint / 3) + 2000, 300);
      case 'evaluate': return this.anthropicCost(model, Math.ceil(sizeHint / 3) + 4000, 3000);
      case 'stt': return this.sttCost(model, Math.max(1, sizeHint));
      case 'tts': return this.ttsCost(model, Math.max(1, sizeHint));
    }
  }
  get currency() { return this.data.currency; }
}
