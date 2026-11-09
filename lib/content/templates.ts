/**
 * Starter templates for different kinds of sales. Every organisation, product and price here is
 * fictional and exists only for practice. A manager loads a template into the campaign draft and
 * can add its five practice scenarios, then edits everything to match their real offer.
 */
import type { CampaignPack } from '../domain/types.ts';
import type { SalesChannel } from '../domain/sales.ts';
import { FICTIONAL_CAMPAIGN } from './campaign.ts';
import { SCENARIOS } from './scenarios.ts';

export interface TemplateScenario { title: string; persona: string; opener: string; objection: string; goal: string; allowedEnding: string; behaviour: string; skill: string }
export interface SalesTemplate {
  id: string;
  label: string;
  channel: SalesChannel;
  blurb: string;
  pack: Omit<CampaignPack, 'version'>;
  scenarios: TemplateScenario[];
}

const fromBuiltIn = SCENARIOS.map(({ title, persona, opener, objection, goal, allowedEnding, behaviour, skill }) => ({ title, persona, opener, objection, goal, allowedEnding, behaviour, skill }));
const { version: _v, ...charityPack } = FICTIONAL_CAMPAIGN;

export const SALES_TEMPLATES: SalesTemplate[] = [
  {
    id: 'door-fundraising', label: 'Door-to-door fundraising', channel: 'door-to-door',
    blurb: 'Knocking on doors to invite regular charity gifts.',
    pack: { ...charityPack, sales_context: { channel: 'door-to-door', offer: 'an optional £10 monthly gift', customer_label: 'resident', good_outcome: 'a clear, voluntary decision either way' } },
    scenarios: fromBuiltIn,
  },
  {
    id: 'telesales', label: 'Phone and telesales', channel: 'phone',
    blurb: 'Outbound calls to existing customers about an upgrade.',
    pack: {
      campaign_key: 'brightline-fibre-demo', name: 'BrightLine full-fibre upgrade (fictional)', fictional: true, organisation: 'BrightLine Broadband (fictional)',
      approved_facts: [
        { id: 'F1', text: 'BrightLine Broadband is a fictional provider used for practice.' },
        { id: 'F2', text: 'The full-fibre upgrade is £32 a month on an 18-month contract.' },
        { id: 'F3', text: 'Installation is free and customers keep their current phone number and email address.' },
        { id: 'F4', text: 'There is a 14-day cooling-off period after agreeing.' },
        { id: 'F5', text: 'Anything else (exact speeds at an address, early-exit fees, installation dates) must be checked, not guessed.' },
      ],
      forbidden_claims: ['Promising a specific speed at the customer\'s address', 'Saying the price will never go up', 'Claiming the current service is being switched off'],
      must_say: [
        { id: 'M1', text: 'Say who you are, that you are calling from BrightLine, and why you are calling.', cues: ['calling from', 'my name is', "I'm", 'BrightLine'] },
        { id: 'M2', text: 'Check it is a good time to talk.', cues: ['good time', 'got a minute', 'is now okay', 'convenient'] },
        { id: 'M3', text: 'Mention the 14-day cooling-off period before any agreement.', cues: ['14 days', 'cooling-off', 'change your mind'] },
      ],
      never_say: ['this offer ends today', 'everyone is switching', "you'd be mad not to", "it's basically free", "I'm not trying to sell you anything"],
      objection_answers: [
        { objection: "I'm happy with what I've got.", answer: "That's fair, and there's no need to change if it works for you. Can I ask how you mostly use your internet at home?" },
        { objection: 'Send me something in writing.', answer: 'Of course. I can send the details by email so you can read them in your own time, with no commitment.' },
        { objection: 'How did you get my number?', answer: "You're an existing BrightLine customer, so we're calling about your account. If you'd rather not get calls like this, I can note that." },
        { objection: "That's more than I pay now.", answer: "Understood. I'll be clear on the price and contract so you can compare properly, and it's completely fine to stay as you are." },
      ],
      sample_opening: "Hi, is that Jordan? It's Sam calling from BrightLine Broadband about your account. Is now an okay time for two minutes?",
      sample_explanation: "Full fibre is now available on your street. It's £32 a month on an 18-month contract, installation is free and you keep your number. There's also a 14-day cooling-off period.",
      sample_unknown_answer: "I don't want to guess on that. I'll check and come back to you with the exact answer.",
      sample_disengagement: 'No problem at all. Thanks for your time, and have a good day.',
      sales_context: { channel: 'phone', offer: 'a full-fibre broadband upgrade', customer_label: 'customer', good_outcome: 'an informed decision, or a call back at a better time' },
    },
    scenarios: [
      { title: 'Picks up mid-task', persona: 'Jordan, cooking dinner', opener: 'Hello? Sorry, who is this?', objection: "Wasn't expecting a call", goal: 'Introduce yourself and the reason for the call clearly, and check it is a good time.', allowedEnding: 'A short explanation with permission, or arranging a better time to call.', behaviour: 'Distracted and a little wary; warms up if the rep is clear and asks permission; ends the call if the rep talks over them.', skill: 'Opening a call' },
      { title: 'Happy with current deal', persona: 'Priya, long-time customer', opener: "I'm happy with what I've got, thanks.", objection: 'No reason to change', goal: 'Acknowledge it, ask one relevant question, and only share facts that matter to her.', allowedEnding: 'Priya asks a question, agrees to hear more, or politely declines.', behaviour: 'Content but open if the rep listens; dislikes being told she is wrong.', skill: 'Listening and relevance' },
      { title: 'Wary of scams', persona: 'Graham, retired', opener: "How do I know you're really from BrightLine?", objection: 'Suspects a scam call', goal: 'Reassure honestly without asking for personal or payment details, and offer a safe way to check.', allowedEnding: 'Graham feels reassured, or prefers to call back on the official number.', behaviour: 'Polite but guarded; never gives personal details; ends the call if pressured.', skill: 'Trust and honesty' },
      { title: 'Price and contract check', persona: 'Aisha, budget-conscious', opener: 'How much is it, and how long am I tied in?', objection: 'Cost and contract length', goal: 'State the price, contract length and cooling-off period accurately.', allowedEnding: 'Aisha understands the terms and decides, or asks for them in writing.', behaviour: 'Direct; asks follow-up questions about exit fees that the facts do not cover.', skill: 'Clear explanation' },
      { title: 'Wants the call to end', persona: 'Tom', opener: 'Not interested. Please take me off your list.', objection: 'Asks to end the call', goal: 'End promptly and courteously.', allowedEnding: 'A courteous goodbye is the only right ending.', behaviour: 'The boundary is final; any further pitch makes him hang up.', skill: 'Respectful close' },
    ],
  },
  {
    id: 'retail', label: 'Shop floor and retail', channel: 'retail',
    blurb: 'Offering an optional care plan with an in-store purchase.',
    pack: {
      campaign_key: 'fernbridge-care-plan-demo', name: 'Fernbridge laptop Care Plan (fictional)', fictional: true, organisation: 'Fernbridge Electricals (fictional)',
      approved_facts: [
        { id: 'F1', text: 'Fernbridge Electricals is a fictional shop used for practice.' },
        { id: 'F2', text: 'The 3-year Care Plan costs £79, paid once, for laptops under £1,000.' },
        { id: 'F3', text: "It covers accidental damage, and repairs after the manufacturer's one-year warranty ends." },
        { id: 'F4', text: 'Customers can cancel within 45 days for a full refund.' },
        { id: 'F5', text: 'Anything else (exclusions, claim limits, other products) must be checked, not guessed.' },
      ],
      forbidden_claims: ['Saying the laptop is not covered without the plan', 'Inventing failure rates', 'Saying the plan is compulsory'],
      must_say: [
        { id: 'M1', text: "Make clear the Care Plan is optional and the manufacturer's warranty still applies.", cues: ['optional', 'up to you', "manufacturer's warranty", 'still covered'] },
        { id: 'M2', text: 'Mention that it can be cancelled within 45 days for a full refund.', cues: ['45 days', 'cancel', 'full refund'] },
      ],
      never_say: ["you'll definitely need it", 'most people regret not getting it', "it's required", 'the warranty is useless'],
      objection_answers: [
        { objection: "I've already got insurance at home.", answer: "That's worth checking, as some home policies do cover laptops. The plan is optional, so it's only worth it if you're not already covered." },
        { objection: "Laptops don't break.", answer: "Plenty don't, and the manufacturer's warranty covers faults in the first year anyway. The plan mainly helps with accidents and later repairs." },
        { objection: "I'll think about it.", answer: "Of course. There's no pressure, and if you add it today you can still cancel within 45 days." },
        { objection: "It's too expensive.", answer: "Understood. It's £79 once, and it's completely optional. Your laptop is still covered by its own warranty." },
      ],
      sample_opening: "Hi, I'm Sam. Great choice on that laptop. Can I mention one optional extra before you pay? It'll take thirty seconds.",
      sample_explanation: "The Care Plan is £79 once and covers accidental damage, plus repairs after the one-year warranty ends. It's optional, and you can cancel within 45 days for a full refund.",
      sample_unknown_answer: "I'm not certain on that one, so let me check rather than guess.",
      sample_disengagement: 'No problem at all. Enjoy the new laptop.',
      sales_context: { channel: 'retail', offer: 'an optional 3-year Care Plan', customer_label: 'customer', good_outcome: 'an informed choice, with no pressure either way' },
    },
    scenarios: [
      { title: 'Just browsing', persona: 'Leah, looking at laptops', opener: "I'm just looking, thanks.", objection: 'Not ready to talk', goal: 'Respect that, offer help lightly, and leave the door open.', allowedEnding: 'Leah asks a question, or carries on browsing on her own.', behaviour: 'Polite but wants space; opens up a little if the rep is relaxed and brief.', skill: 'Light-touch approach' },
      { title: 'Already insured', persona: 'Mark, practical', opener: "Isn't this covered by my home insurance anyway?", objection: 'May already be covered', goal: 'Answer honestly, suggesting he checks his policy, without overstating the plan.', allowedEnding: 'Mark decides, or goes away to check his policy.', behaviour: 'Sensible and a bit sceptical; respects honesty, dislikes pushiness.', skill: 'Honest advice' },
      { title: 'Pushes back on price', persona: 'Sophie, student', opener: "Seventy-nine pounds on top? That's a lot.", objection: 'Cost', goal: 'Acknowledge the cost, explain the cover accurately and make clear it is optional.', allowedEnding: 'Sophie understands and decides either way.', behaviour: 'Budget-conscious; asks what it actually covers.', skill: 'Handling price' },
      { title: 'In a hurry at the till', persona: 'Dev, on a parking meter', opener: "Can we just get this paid? I'm parked on a meter.", objection: 'Short on time', goal: 'Respect his time: one short sentence about the plan at most, or none.', allowedEnding: 'A quick, courteous checkout.', behaviour: 'Impatient; gets annoyed by anything longer than a sentence.', skill: 'Reading the moment' },
      { title: 'Firm no', persona: 'Ruth', opener: 'No add-ons, just the laptop please.', objection: 'Clear refusal', goal: 'Accept it straight away and complete the sale politely.', allowedEnding: 'Polite checkout with no further mention of the plan.', behaviour: 'The boundary is final; repeated offers make her leave.', skill: 'Accepting no' },
    ],
  },
  {
    id: 'b2b', label: 'Business meetings (B2B)', channel: 'b2b-meeting',
    blurb: 'A short meeting with a small-business owner about software.',
    pack: {
      campaign_key: 'ledgerleaf-demo', name: 'LedgerLeaf bookkeeping (fictional)', fictional: true, organisation: 'LedgerLeaf (fictional)',
      approved_facts: [
        { id: 'F1', text: 'LedgerLeaf is fictional bookkeeping software used for practice.' },
        { id: 'F2', text: 'Plans start at £18 a month per business; the first 30 days are free with no card needed.' },
        { id: 'F3', text: 'It connects to UK bank feeds and can file Making Tax Digital VAT returns.' },
        { id: 'F4', text: 'Plans are monthly and can be cancelled at any time.' },
        { id: 'F5', text: 'Anything else (integrations, data migration costs, security certifications) must be checked, not guessed.' },
      ],
      forbidden_claims: ['Guaranteeing time or money savings', "Claiming accountants won't be needed", 'Inventing integrations or certifications'],
      must_say: [
        { id: 'M1', text: 'Ask at least one question about how they handle bookkeeping today.', cues: ['how do you', 'currently', 'at the moment', 'today'] },
        { id: 'M2', text: "Agree a clear next step, or confirm there isn't one.", cues: ['next step', 'follow up', 'trial', 'send you'] },
      ],
      never_say: ['guaranteed to save you money', 'our competitors are rubbish', "you'll be fined if you don't", 'just sign today'],
      objection_answers: [
        { objection: 'We already use a spreadsheet.', answer: "Plenty of businesses do, and it can work well. What's the most time-consuming part of keeping it up to date?" },
        { objection: 'Our accountant handles all that.', answer: 'That makes sense. Some accountants like clients using software because it saves them time too. Would it help to show it to them?' },
        { objection: "I don't have time to switch.", answer: "Understood. The trial is free for 30 days with no card, so there's no rush, and you can stop at any time." },
        { objection: 'Send me a proposal.', answer: "Happy to. So it's useful, can I check two things about how you work first?" },
      ],
      sample_opening: "Thanks for making the time, Helen. I'm Sam from LedgerLeaf. I've got about ten minutes. Shall I start by asking how you handle your books at the moment?",
      sample_explanation: "LedgerLeaf connects to your bank feed and can file your VAT returns. It's from £18 a month, monthly, and you can try it free for 30 days without a card.",
      sample_unknown_answer: "Good question. I don't want to guess, so I'll check and email you the answer.",
      sample_disengagement: "Understood, it doesn't sound like the right time. Thanks for seeing me. Can I leave my details in case that changes?",
      sales_context: { channel: 'b2b-meeting', offer: 'bookkeeping software for small businesses', customer_label: 'prospect', good_outcome: 'an agreed next step, such as a trial or follow-up, or a clear no' },
    },
    scenarios: [
      { title: 'Five minutes between meetings', persona: 'Helen, café owner', opener: "I've got five minutes. What is it?", objection: 'Very short on time', goal: 'Get to the point, ask one good question and agree a next step.', allowedEnding: 'A short follow-up is agreed, or Helen politely ends it.', behaviour: 'Brisk and practical; values directness; switches off at jargon.', skill: 'Getting to the point' },
      { title: 'Accountant does it', persona: 'Raj, builder', opener: 'My accountant sorts all that out.', objection: 'Thinks he does not need it', goal: 'Respect his setup, ask a question and find out whether there is a real need.', allowedEnding: 'Raj sees a reason to look further, or the rep accepts there is no fit.', behaviour: 'Friendly but not technical; responds to plain language about his week.', skill: 'Discovery questions' },
      { title: 'Burned before', persona: 'Claire, florist', opener: 'We tried software last year and it was a nightmare.', objection: 'Bad past experience', goal: 'Acknowledge it, find out what went wrong, and avoid overpromising.', allowedEnding: 'Claire agrees to a low-risk trial, or declines.', behaviour: 'Frustrated at first; softens if the rep listens rather than defends.', skill: 'Handling scepticism' },
      { title: 'Needs sign-off', persona: 'Owen, office manager', opener: 'I like it, but my business partner decides.', objection: 'Not the decision-maker', goal: 'Help Owen take it to his partner, and agree how to follow up.', allowedEnding: 'A clear plan to involve the partner, or a follow-up date.', behaviour: 'Positive but cautious; asks what to tell his partner.', skill: 'Agreeing next steps' },
      { title: 'Not a priority', persona: 'Mia, shop owner', opener: "Honestly, this isn't a priority for us this year.", objection: 'Bad timing', goal: 'Accept it gracefully and leave a light, no-pressure route back.', allowedEnding: 'A courteous end, optionally with permission to follow up later.', behaviour: 'Clear and settled; will not be persuaded today.', skill: 'Graceful close' },
    ],
  },
  {
    id: 'field', label: 'Field sales and home visits', channel: 'field',
    blurb: 'A booked visit to a homeowner about a free solar survey.',
    pack: {
      campaign_key: 'suntile-solar-demo', name: 'SunTile home solar survey (fictional)', fictional: true, organisation: 'SunTile Solar (fictional)',
      approved_facts: [
        { id: 'F1', text: 'SunTile Solar is a fictional company used for practice.' },
        { id: 'F2', text: 'A free, no-obligation roof survey takes about 45 minutes.' },
        { id: 'F3', text: 'Quotes are given in writing and are valid for 30 days.' },
        { id: 'F4', text: 'Customers have a 14-day cancellation period after signing.' },
        { id: 'F5', text: 'Savings depend on the roof and the household; figures must not be promised and anything else must be checked.' },
      ],
      forbidden_claims: ['Promising a specific saving or payback time', 'Saying a grant or government scheme will pay', 'Claiming prices rise tomorrow'],
      must_say: [
        { id: 'M1', text: 'Say the survey and quote are free and there is no obligation.', cues: ['no obligation', 'free', 'no commitment', 'up to you'] },
        { id: 'M2', text: 'Mention the 14-day cancellation period if they consider signing.', cues: ['14 days', 'cancel', 'cooling-off'] },
      ],
      never_say: ["you'll save thousands", 'this price is only for today', 'the government will pay for it', 'your neighbours have all signed'],
      objection_answers: [
        { objection: 'Is it worth it?', answer: "It depends on your roof and how you use energy, which is exactly what the free survey shows. There's no obligation afterwards." },
        { objection: 'We might move in a few years.', answer: "That's a sensible thing to weigh up. The survey and written quote are free, so you can decide with the facts." },
        { objection: 'I need to talk to my partner.', answer: 'Of course. The quote is in writing and valid for 30 days, so you can look at it together.' },
        { objection: "I've heard solar's a scam.", answer: "Some people have had bad experiences, so it's right to be careful. Everything we offer is in writing, and you can cancel within 14 days of signing." },
      ],
      sample_opening: "Hi, I'm Sam from SunTile. Thanks for booking the visit. Before I start, is now still a good time?",
      sample_explanation: "I'll do a free survey of your roof, about 45 minutes, and give you a written quote that's valid for 30 days. There's no obligation at all.",
      sample_unknown_answer: "I can't promise a figure without the survey, and I'd rather not guess. I'll check and confirm in writing.",
      sample_disengagement: "That's absolutely fine. Thanks for your time, and I'll see myself out.",
      sales_context: { channel: 'field', offer: 'a free solar survey and written quote', customer_label: 'homeowner', good_outcome: 'a completed survey, or a clear decision not to go ahead' },
    },
    scenarios: [
      { title: 'Second thoughts at the door', persona: 'Paul, booked the visit', opener: "I booked this, but I'm not sure now.", objection: 'Cold feet', goal: 'Reassure without pressure: explain the survey is free with no obligation, and let him decide.', allowedEnding: 'Paul goes ahead with the survey, or reschedules, or cancels politely.', behaviour: 'Hesitant; relaxes if the rep is calm and honest; firms up against pressure.', skill: 'Reassurance without pressure' },
      { title: 'How much will I save?', persona: 'Fatima, numbers person', opener: 'Just tell me how much I will save.', objection: 'Wants a figure now', goal: 'Explain honestly why a figure needs the survey, without promising one.', allowedEnding: 'Fatima accepts the survey, or decides not to proceed.', behaviour: 'Persistent; pushes for a number two or three times.', skill: 'Honesty under pressure' },
      { title: "Partner's not home", persona: 'Ben', opener: 'My wife deals with this sort of thing.', objection: 'Other decision-maker', goal: 'Offer to do the survey now or rebook so both can be there; leave written details.', allowedEnding: 'A rebooked visit or a survey with information to share.', behaviour: 'Friendly, slightly unsure; worries about deciding alone.', skill: 'Involving decision-makers' },
      { title: 'Heard bad things', persona: 'Julie, cautious', opener: 'My neighbour got ripped off by a solar company.', objection: 'Fear of being misled', goal: 'Acknowledge it, avoid criticising others, and explain the written quote and cancellation rights.', allowedEnding: 'Julie feels able to decide calmly, either way.', behaviour: 'Wary; asks pointed questions; responds to plain honesty.', skill: 'Building trust' },
      { title: 'Asks you to leave', persona: 'Ken', opener: "I've changed my mind. I'd rather you went.", objection: 'Ends the visit', goal: 'Leave promptly and courteously.', allowedEnding: 'A polite exit is the only right ending.', behaviour: 'Calm but final; any further pitch upsets him.', skill: 'Respectful exit' },
    ],
  },
  {
    id: 'events', label: 'Events, stands and street', channel: 'events',
    blurb: 'Stopping shoppers at a stand to offer a gym day pass.',
    pack: {
      campaign_key: 'pulse-gym-demo', name: 'Pulse Gym stand (fictional)', fictional: true, organisation: 'Pulse Gym (fictional)',
      approved_facts: [
        { id: 'F1', text: 'Pulse Gym is a fictional gym chain used for practice.' },
        { id: 'F2', text: 'Membership is £29.99 a month with no joining fee this month.' },
        { id: 'F3', text: 'Anyone can try a free day pass first, with no commitment.' },
        { id: 'F4', text: "Memberships are rolling monthly with 30 days' notice to cancel." },
        { id: 'F5', text: 'Anything else (class timetables, personal training prices, other sites) must be checked, not guessed.' },
      ],
      forbidden_claims: ['Promising weight loss or fitness results', 'Saying the offer ends today', 'Commenting on how anyone looks'],
      must_say: [
        { id: 'M1', text: 'Introduce yourself and say where you are from.', cues: ["I'm", 'from Pulse', 'my name'] },
        { id: 'M2', text: 'Offer the free day pass as a no-commitment option.', cues: ['free day pass', 'try it', 'no commitment'] },
      ],
      never_say: ['only three spots left', 'you need this', 'you look like you could use it', 'sign now or miss out'],
      objection_answers: [
        { objection: "I'm in a rush.", answer: 'No problem. Here is a free day pass to try another time. Have a good day.' },
        { objection: "I don't do gyms.", answer: "That's fair, and lots of people feel that way. If you ever fancy trying it, the day pass is free with no commitment." },
        { objection: "I'm already a member somewhere.", answer: 'Great that you train already. If you ever want to compare, the day pass is free.' },
        { objection: "I can't afford it.", answer: "Completely understood. There's no pressure at all, and the day pass costs nothing." },
      ],
      sample_opening: "Hi, I'm Sam from Pulse Gym. We're giving out free day passes today. Have you got ten seconds?",
      sample_explanation: "It's £29.99 a month with no joining fee this month, rolling monthly with 30 days' notice. Or just try a free day pass first, no commitment.",
      sample_unknown_answer: "I don't know the timetable off by heart, so I'll check rather than guess.",
      sample_disengagement: 'No worries at all. Enjoy the rest of your day.',
      sales_context: { channel: 'events', offer: 'a free day pass and gym membership', customer_label: 'passer-by', good_outcome: 'a day pass taken, a membership question, or a friendly no' },
    },
    scenarios: [
      { title: 'Walking past fast', persona: 'Zoe, shopping', opener: "Sorry, I'm in a rush.", objection: 'No time', goal: 'Respect it in one sentence: offer the pass or let her go.', allowedEnding: 'Zoe takes a pass in passing, or walks on with a smile.', behaviour: 'Keeps walking; anything longer than a sentence loses her.', skill: 'Ten-second pitch' },
      { title: 'Already a member elsewhere', persona: 'Liam, regular gym-goer', opener: 'I already go to a gym.', objection: 'Has an alternative', goal: 'Acknowledge it without criticising his gym; offer the pass to compare.', allowedEnding: 'Liam takes a pass or declines politely.', behaviour: 'Confident, mildly curious about classes the pack does not cover.', skill: 'Acknowledging alternatives' },
      { title: "Gyms aren't for me", persona: 'Grace, self-conscious', opener: "Gyms aren't really for me.", objection: 'Feels out of place', goal: 'Be warm and respectful, never comment on appearance, keep the pass optional.', allowedEnding: 'Grace feels respected, whatever she decides.', behaviour: 'Quiet; withdraws quickly if the rep is pushy or personal.', skill: 'Sensitivity' },
      { title: "What's the catch?", persona: 'Sam, sceptical', opener: "What's the catch with the free pass?", objection: 'Suspicious of free offers', goal: 'Explain plainly there is no commitment, using approved facts only.', allowedEnding: 'Sam takes the pass, or declines having understood it.', behaviour: 'Pokes at the details; respects straight answers.', skill: 'Plain honesty' },
      { title: 'Asks to be left alone', persona: 'Nina', opener: "Please don't follow me.", objection: 'Clear boundary', goal: 'Stop immediately and apologise briefly.', allowedEnding: 'The rep steps back courteously at once.', behaviour: 'The boundary is final.', skill: 'Respecting boundaries' },
    ],
  },
];

export function getTemplate(id: string): SalesTemplate | undefined {
  return SALES_TEMPLATES.find((t) => t.id === id);
}
