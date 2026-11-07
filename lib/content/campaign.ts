import type { CampaignPack } from '../domain/types.ts';

/**
 * Fictional demo campaign — copied from the build pack, section 7.
 * No real charity, donation or payment process exists.
 */
export const FICTIONAL_CAMPAIGN: CampaignPack = {
  campaign_key: 'neighbourhood-meal-project-demo',
  version: 1,
  name: 'Neighbourhood Meal Project — fictional demo',
  fictional: true,
  organisation: 'Neighbourhood Meal Project (fictional)',
  approved_facts: [
    { id: 'F1', text: 'This fictional project supports community meal sessions.' },
    { id: 'F2', text: 'The fictional campaign invites an optional monthly gift of £10.' },
    { id: 'F3', text: 'A donation is voluntary; declining is acceptable.' },
    { id: 'F4', text: 'This practice app cannot collect donations or personal payment details.' },
    { id: 'F5', text: 'If asked about unprovided impact figures, costs, cancellation procedures or registration, the rep must say they need to check approved information.' },
  ],
  forbidden_claims: [
    'Inventing charity registration numbers or partnerships',
    'Claiming a precise number of meals per pound',
    'Claiming all donations reach beneficiaries',
    'Suggesting anyone is required to donate',
  ],
  must_say: [
    { id: 'M1', text: 'Say who you are and which organisation you are representing.', cues: ["I'm", 'my name is', 'on behalf of', 'from the'] },
    { id: 'M2', text: 'Make clear that giving is voluntary and it is fine to say no.', cues: ['voluntary', 'no pressure', 'fine to say no', 'fine to decline', 'no obligation', 'up to you'] },
  ],
  never_say: [
    'you have to',
    'everyone on your street has signed up',
    "you won't even miss it",
    'only the price of a coffee',
    'last chance',
  ],
  objection_answers: [
    { objection: 'I already give to charity.', answer: "That's great that you already support causes you care about. I'll keep it brief, and it's completely fine if this isn't for you." },
    { objection: "I'm busy right now.", answer: "No problem. I can give you the ten-second version, or leave you to it, whichever you prefer." },
    { objection: 'How do I know this is legitimate?', answer: "That's a fair question. I don't have approved details on registration with me, so I'd need to check rather than guess." },
    { objection: "I can't afford it.", answer: "That's completely understandable, and there's no pressure at all. Thanks for listening." },
  ],
  sample_opening: "Hi, I'm Sam, practising on behalf of the fictional Neighbourhood Meal Project. Have you got a moment for me to explain it?",
  sample_explanation: "In this fictional campaign we're inviting an optional £10 monthly gift to support community meal sessions. I can explain what information I have, and it's completely fine to decline.",
  sample_unknown_answer: "I don't have approved information on that, so I'd need to check rather than guess.",
  sample_disengagement: "Of course. Thanks for your time; I'll leave you to it.",
};

export const FICTIONAL_LABEL = 'Fictional demo campaign';
