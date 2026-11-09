import { z } from 'zod';
import { SALES_CHANNELS } from './sales.ts';
import { CONCERN_TYPES, DIMENSION_KEYS, DRILL_KEYS, SCENARIO_KEY_PATTERN } from './types.ts';
import { LIMITS } from './limits.ts';

const boundedText = (max: number) => z.string().trim().min(1).max(max);
const turnId = z.string().regex(/^(resident|rep)-\d{1,3}$/, 'turn_id must look like rep-1 or resident-1');
export const scenarioKeySchema = z.string().regex(SCENARIO_KEY_PATTERN, 'scenario key: 2–40 lowercase letters, digits or hyphens');
const mustSayId = z.string().regex(/^M\d{1,2}$/);

export const evidenceSchema = z.object({
  turn_id: turnId,
  quote: z.string().min(1).max(300),
}).strict();

export const dimensionResultSchema = z.object({
  key: z.enum(DIMENSION_KEYS),
  score: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.null()]),
  reason: boundedText(400),
  evidence: z.array(evidenceSchema).max(4),
}).strict();

export const concernSchema = z.object({
  type: z.enum(CONCERN_TYPES),
  explanation: boundedText(400),
  evidence: z.array(evidenceSchema).min(1).max(4),
  contradicted_fact_id: z.string().regex(/^F\d{1,2}$/).nullable(),
}).strict();

const pointer = z.object({ text: boundedText(300), turn_ids: z.array(turnId).min(1).max(4) }).strict();

export const requiredStatementSchema = z.object({
  id: mustSayId,
  said: z.boolean(),
  evidence: z.array(evidenceSchema).max(4),
}).strict();

/** Structural contract for evaluator output (build pack section 8). Semantic checks live in evaluation-validator.ts. */
export const evaluationResultSchema = z.object({
  schema_version: z.literal('1.1'),
  rubric_version: z.string().min(1).max(40),
  transcript_revision: z.number().int().min(1).max(1000),
  dimensions: z.array(dimensionResultSchema).length(5),
  strength: pointer.nullable(),
  improvement: pointer.nullable(),
  concerns: z.array(concernSchema).max(6),
  required_statements: z.array(requiredStatementSchema).max(10),
  retry: z.object({
    objective: boundedText(240),
    scenario_key: scenarioKeySchema,
    drill_key: z.enum(DRILL_KEYS).nullable(),
    max_seconds: z.number().int().min(10).max(LIMITS.drillSeconds),
  }).strict(),
  limitations: z.array(z.string().trim().min(1).max(240)).max(6),
}).strict();

export const residentResultSchema = z.object({
  utterance: z.string().trim().max(LIMITS.residentUtteranceMaxChars),
  endConversation: z.boolean(),
  reason: z.string().max(120).nullable(),
}).strict();

// ---- API inputs ----
const idempotencyKey = z.string().min(8).max(100).regex(/^[A-Za-z0-9_\-:.]+$/);
const uuid = z.string().uuid();

export const startSessionInput = z.object({
  scenarioKey: scenarioKeySchema,
  drillKey: z.enum(DRILL_KEYS).nullable().optional(),
  parentSessionId: uuid.nullable().optional(),
  idempotencyKey,
}).strict();

export const typedTurnInput = z.object({
  text: z.string().trim().min(1).max(LIMITS.typedTurnMaxChars),
  expectedSequence: z.number().int().min(1).max(100),
  idempotencyKey,
}).strict();

export const audioTurnMeta = z.object({
  expectedSequence: z.coerce.number().int().min(1).max(100),
  idempotencyKey,
  durationMs: z.coerce.number().int().min(0).max(LIMITS.recordingMaxSeconds * 1000 + 2000).optional(),
});

export const endSessionInput = z.object({ idempotencyKey }).strict();

export const reportInput = z.object({
  reason: z.enum(['transcription_error', 'feedback_incorrect', 'other']),
  description: z.string().trim().min(3).max(1000),
  turnId: turnId.nullable().optional(),
}).strict();

export const reviewInput = z.object({
  note: z.string().trim().min(1).max(2000),
  resolution: z.enum(['noted', 'coaching_planned', 'feedback_disputed', 'resolved']),
  concernIndex: z.number().int().min(0).max(10).nullable().optional(),
  reportId: uuid.nullable().optional(),
}).strict();

export const correctionInput = z.object({
  turnId,
  correctedText: z.string().trim().min(1).max(LIMITS.typedTurnMaxChars),
  note: z.string().trim().max(500).optional(),
  idempotencyKey,
}).strict();

export const invitationInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(['rep', 'manager']),
  expiresInDays: z.number().int().min(1).max(14).default(7),
}).strict();

export const acceptInvitationInput = z.object({ token: z.string().min(32).max(128).regex(/^[A-Za-z0-9_-]+$/) }).strict();

export const deletionRequestInput = z.object({
  scope: z.enum(['my_transcripts', 'my_account']),
  note: z.string().trim().max(500).optional(),
}).strict();

export const campaignPackSchema = z.object({
  campaign_key: z.string().regex(/^[a-z0-9-]{3,80}$/),
  version: z.number().int().min(1),
  name: boundedText(120),
  fictional: z.boolean(),
  organisation: boundedText(120),
  approved_facts: z.array(z.object({ id: z.string().regex(/^F\d{1,2}$/), text: boundedText(400) }).strict()).min(1).max(30)
    .refine((facts) => new Set(facts.map((f) => f.id)).size === facts.length, 'Fact IDs must be unique'),
  forbidden_claims: z.array(boundedText(200)).max(30),
  must_say: z.array(z.object({ id: mustSayId, text: boundedText(200), cues: z.array(boundedText(60)).max(8) }).strict()).max(10)
    .refine((items) => new Set(items.map((m) => m.id)).size === items.length, 'Must-say IDs must be unique').default([]),
  never_say: z.array(boundedText(80)).max(30).default([]),
  objection_answers: z.array(z.object({ objection: boundedText(160), answer: boundedText(400) }).strict()).max(15).default([]),
  sample_opening: boundedText(400),
  sample_explanation: boundedText(600),
  sample_unknown_answer: boundedText(400),
  sample_disengagement: boundedText(400),
  sales_context: z.object({
    channel: z.enum(SALES_CHANNELS),
    offer: boundedText(120),
    customer_label: z.string().trim().min(2).max(30).regex(/^[A-Za-z][A-Za-z '-]*$/, 'Use a plain word such as customer or prospect'),
    good_outcome: boundedText(160),
  }).strict().optional(),
}).strict();

export const rubricDimensionsSchema = z.array(z.object({
  key: z.enum(DIMENSION_KEYS),
  label: boundedText(40),
  improvementTip: boundedText(300),
  anchors: z.array(z.object({ score: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]), description: boundedText(300) }).strict()).length(5),
}).strict()).length(5).refine((dims) => new Set(dims.map((d) => d.key)).size === 5, 'Each dimension exactly once')
  .refine((dims) => dims.every((d) => [1, 2, 3, 4, 5].every((s) => d.anchors.some((a) => a.score === s))), 'Every dimension needs anchors 1–5');

/** A manager's scenario. No key = new scenario (the key is made from the title). */
export const scenarioInput = z.object({
  key: scenarioKeySchema.nullable().optional(),
  title: boundedText(80),
  persona: boundedText(80),
  opener: boundedText(300),
  objection: boundedText(120),
  goal: boundedText(300),
  allowedEnding: boundedText(300),
  behaviour: boundedText(400),
  skill: boundedText(60),
}).strict();
export const scenarioArchiveInput = z.object({ archived: z.boolean() }).strict();
export const scenarioAssignmentInput = z.object({ keys: z.array(scenarioKeySchema).max(50) }).strict();

export const campaignDraftInput = z.object({
  pack: campaignPackSchema,
  rubric: rubricDimensionsSchema.optional(),
}).strict();

export type StartSessionInput = z.infer<typeof startSessionInput>;
export type TypedTurnInput = z.infer<typeof typedTurnInput>;
