import type { DimensionKey, RubricVersion } from '../domain/types.ts';

/**
 * Generic example rubric from the build pack, section 8. Scores 2 and 4 describe evidence
 * between adjacent anchors. Agencies edit this through a new rubric version; it is not the
 * owner's complete training method.
 */
export const DEMO_RUBRIC: RubricVersion = {
  version: 'demo-1',
  promptVersion: 'evaluator-v2',
  approvedBy: 'Fictional demo content',
  approvedAt: '2026-11-06T00:00:00.000Z',
  dimensions: [
    {
      key: 'introduction', label: 'Introduction',
      improvementTip: 'Open with who you are and what the visit is about, then ask whether now is a good moment.',
      anchors: [
        { score: 1, description: 'Purpose/identity misleading or obscured.' },
        { score: 2, description: 'Identity or purpose only partly stated, or hard to follow.' },
        { score: 3, description: 'States purpose and identity clearly.' },
        { score: 4, description: 'Clear purpose and identity, with some fit to the resident’s context.' },
        { score: 5, description: 'Clear concise introduction that fits the resident’s context and seeks appropriate permission.' },
      ],
    },
    {
      key: 'accuracy', label: 'Accuracy',
      improvementTip: 'Stick to the approved facts. When you don’t have approved information, say you need to check rather than guess.',
      anchors: [
        { score: 1, description: 'Makes a material unsupported claim.' },
        { score: 2, description: 'Mostly within approved facts but with a vague or loosely stated point.' },
        { score: 3, description: 'Stays within approved facts; handles unknowns honestly.' },
        { score: 4, description: 'Accurate and clear, with unknowns handled honestly.' },
        { score: 5, description: 'Accurate, understandable explanation with an appropriate understanding check.' },
      ],
    },
    {
      key: 'listening', label: 'Listening',
      improvementTip: 'Acknowledge what the resident just said before you answer, and keep the answer short and relevant.',
      anchors: [
        { score: 1, description: 'Ignores the resident’s actual question or boundary.' },
        { score: 2, description: 'Partly responds but drifts into an unrelated or overlong pitch.' },
        { score: 3, description: 'Responds to the question/objection.' },
        { score: 4, description: 'Responds relevantly and acknowledges the concern.' },
        { score: 5, description: 'Acknowledges the concern and gives a concise, relevant response without argument.' },
      ],
    },
    {
      key: 'next_step', label: 'Next step',
      improvementTip: 'Offer one clear, voluntary next step — or end the conversation when that is what the resident wants.',
      anchors: [
        { score: 1, description: 'Pressures or misstates commitment.' },
        { score: 2, description: 'Next step unclear, or voluntariness not made clear.' },
        { score: 3, description: 'Offers a clear voluntary next step, or ends when appropriate.' },
        { score: 4, description: 'Clear voluntary next step that reflects the resident’s wishes.' },
        { score: 5, description: 'Matches the next step to the resident’s wishes and confirms understanding where relevant.' },
      ],
    },
    {
      key: 'respect', label: 'Respect',
      improvementTip: 'When someone says no or asks you to leave, thank them and end straight away.',
      anchors: [
        { score: 1, description: 'Continues pressure after clear refusal.' },
        { score: 2, description: 'Courteous in tone but slow to accept a boundary.' },
        { score: 3, description: 'Courteous and accepts refusal.' },
        { score: 4, description: 'Courteous, and makes clear that declining is acceptable.' },
        { score: 5, description: 'Responds promptly to boundaries while preserving clarity and dignity.' },
      ],
    },
  ],
};

export function dimensionLabel(key: DimensionKey, rubric: RubricVersion = DEMO_RUBRIC): string {
  return rubric.dimensions.find((d) => d.key === key)?.label ?? key;
}
