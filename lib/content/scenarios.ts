import type { Drill, DrillKey, Scenario, ScenarioKey } from '../domain/types.ts';

export const SCENARIOS: Scenario[] = [
  {
    key: 'busy', version: 1, title: 'Interested but busy', persona: 'Alex, heading out',
    opener: "I've only got a moment. What's this about?",
    objection: 'Short on time',
    goal: 'Give a brief, clear introduction and respond to the time constraint.',
    allowedEnding: 'A brief explanation with permission, or a courteous ending when Alex has to go.',
    behaviour: 'Short answers; may allow one brief explanation if asked respectfully; will end if the time boundary is ignored.',
    skill: 'Opening and permission',
  },
  {
    key: 'existing-donor', version: 1, title: '“I already give to charity”', persona: 'Jordan',
    opener: 'I already give to charity.',
    objection: 'Already donates elsewhere',
    goal: 'Acknowledge the existing giving and respond relevantly without arguing or criticising other charities.',
    allowedEnding: 'Jordan declines or asks a relevant question; no obligation to add another gift.',
    behaviour: 'Wants acknowledgement; may ask why this cause is relevant; never obliged to add another gift.',
    skill: 'Listening and relevant response',
  },
  {
    key: 'sceptical', version: 1, title: 'Sceptical resident', persona: 'Casey',
    opener: 'How do I know this is legitimate?',
    objection: 'Questions legitimacy',
    goal: 'Explain identity and the approved cause accurately, without inventing answers.',
    allowedEnding: 'Casey accepts an honest need to check, or politely declines.',
    behaviour: 'Asks identity and verification questions; accepts an honest need to check; does not accept invented facts.',
    skill: 'Accuracy and trust',
  },
  {
    key: 'monthly-giving', version: 1, title: 'Asks about monthly giving', persona: 'Morgan',
    opener: "Is this a one-off donation or every month?",
    objection: 'Checks the commitment',
    goal: 'Explain the approved commitment plainly and handle unknown details honestly.',
    allowedEnding: 'Morgan understands the optional monthly gift and decides, or declines.',
    behaviour: 'Checks commitment and amount; may ask cancellation details that the fictional pack does not supply.',
    skill: 'Clarity of explanation',
  },
  {
    key: 'firm-refusal', version: 1, title: 'Firm refusal', persona: 'Taylor',
    opener: 'No thank you. Please leave.',
    objection: 'Asks the rep to leave',
    goal: 'End promptly and courteously.',
    allowedEnding: 'Polite disengagement is the only appropriate next step.',
    behaviour: 'Boundary is final; the only appropriate next step is polite disengagement.',
    skill: 'Respectful disengagement',
  },
];

export const DRILLS: Drill[] = [
  { key: 'already-donate', title: 'Already donates', baseScenario: 'existing-donor', opener: 'I already give to a couple of charities, to be honest.', objective: 'Acknowledge their existing giving in one or two sentences without arguing.' },
  { key: 'busy', title: 'Busy', baseScenario: 'busy', opener: "I'm in a real rush, sorry.", objective: 'Respect the time limit: offer a ten-second version or a courteous ending.' },
  { key: 'not-interested', title: 'Not interested', baseScenario: 'firm-refusal', opener: "I'm not interested, thanks.", objective: 'Accept the answer and end courteously in one sentence.' },
  { key: 'cannot-afford', title: "Can't afford it", baseScenario: 'existing-donor', opener: "Money's tight at the moment, I can't afford anything extra.", objective: 'Acknowledge the situation and make clear declining is completely fine.' },
  { key: 'prefers-one-off', title: 'Prefers one-off gifts', baseScenario: 'monthly-giving', opener: 'I only really do one-off donations.', objective: 'Explain accurately that this campaign invites an optional monthly gift, without pressure.' },
  { key: 'legitimacy', title: 'Asks legitimacy', baseScenario: 'sceptical', opener: 'Have you got any ID or a registration number?', objective: 'Answer honestly; say you would need to check anything not in the approved pack.' },
  { key: 'amount', title: 'Asks the amount', baseScenario: 'monthly-giving', opener: 'How much are you actually asking for?', objective: 'State the optional £10 monthly gift clearly and that declining is fine.' },
  { key: 'money-use', title: 'Asks how money is used', baseScenario: 'sceptical', opener: 'Where does the money actually go?', objective: 'Use only approved facts; say you need to check impact figures rather than guess.' },
  { key: 'cancellation', title: 'Asks about cancelling', baseScenario: 'monthly-giving', opener: 'And how would I cancel if I changed my mind?', objective: 'Say honestly that you would need to check the approved cancellation information.' },
  { key: 'asks-to-end', title: 'Asks to end', baseScenario: 'firm-refusal', opener: "I'd like you to go now, please.", objective: 'Disengage promptly and courteously in one sentence.' },
];

export function getScenario(key: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.key === key);
}

export function getDrill(key: string): Drill | undefined {
  return DRILLS.find((d) => d.key === key);
}

export function scenarioForDrill(key: DrillKey): ScenarioKey {
  return getDrill(key)?.baseScenario ?? 'busy';
}
