/**
 * JSON Schemas sent as Claude structured outputs (output_config.format, type json_schema).
 * Per the docs checked on 2026-11-06, numeric/length constraints (minimum, maxLength, …) are not
 * supported in the sent schema, so bounds are enforced afterwards by the Zod schema + validator.
 */
const evidence = {
  type: 'object', additionalProperties: false, required: ['turn_id', 'quote'],
  properties: { turn_id: { type: 'string' }, quote: { type: 'string' } },
};
const pointer = { anyOf: [{ type: 'null' }, {
  type: 'object', additionalProperties: false, required: ['text', 'turn_ids'],
  properties: { text: { type: 'string' }, turn_ids: { type: 'array', items: { type: 'string' } } },
}] };

export const EVALUATION_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['schema_version', 'rubric_version', 'transcript_revision', 'dimensions', 'strength', 'improvement', 'concerns', 'required_statements', 'retry', 'limitations'],
  properties: {
    schema_version: { type: 'string', enum: ['1.1'] },
    rubric_version: { type: 'string' },
    transcript_revision: { type: 'integer' },
    dimensions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['key', 'score', 'reason', 'evidence'],
        properties: {
          key: { type: 'string', enum: ['introduction', 'accuracy', 'listening', 'next_step', 'respect'] },
          score: { anyOf: [{ type: 'null' }, { type: 'integer', enum: [1, 2, 3, 4, 5] }] },
          reason: { type: 'string' },
          evidence: { type: 'array', items: evidence },
        },
      },
    },
    strength: pointer,
    improvement: pointer,
    concerns: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['type', 'explanation', 'evidence', 'contradicted_fact_id'],
        properties: {
          type: { type: 'string', enum: ['unsupported_campaign_claim', 'ignored_stop_request', 'misstated_commitment', 'banned_phrase', 'other_review_needed'] },
          explanation: { type: 'string' },
          evidence: { type: 'array', items: evidence },
          contradicted_fact_id: { anyOf: [{ type: 'null' }, { type: 'string' }] },
        },
      },
    },
    required_statements: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'said', 'evidence'],
        properties: { id: { type: 'string' }, said: { type: 'boolean' }, evidence: { type: 'array', items: evidence } },
      },
    },
    retry: {
      type: 'object', additionalProperties: false, required: ['objective', 'scenario_key', 'drill_key', 'max_seconds'],
      properties: {
        objective: { type: 'string' },
        scenario_key: { type: 'string' },
        drill_key: { anyOf: [{ type: 'null' }, { type: 'string', enum: ['already-donate', 'busy', 'not-interested', 'cannot-afford', 'prefers-one-off', 'legitimacy', 'amount', 'money-use', 'cancellation', 'asks-to-end'] }] },
        max_seconds: { type: 'integer' },
      },
    },
    limitations: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const RESIDENT_JSON_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['utterance', 'endConversation', 'reason'],
  properties: {
    utterance: { type: 'string' },
    endConversation: { type: 'boolean' },
    reason: { anyOf: [{ type: 'null' }, { type: 'string' }] },
  },
} as const;
