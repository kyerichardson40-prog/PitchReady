/**
 * First-time questions (the /welcome page). Answers are stored as these keys; the labels can be
 * reworded without touching saved answers. `scenario` links a struggle to the built-in practice
 * scenario that works on it, so reps see "Suggested for you" on the Practise page.
 */
export interface OnboardingOption { key: string; label: string; scenario?: string }

export const REP_STRUGGLES: OnboardingOption[] = [
  { key: 'opening', label: 'Starting the conversation', scenario: 'busy' },
  { key: 'nerves', label: 'Nerves and confidence', scenario: 'busy' },
  { key: 'objections', label: 'Handling objections', scenario: 'existing-donor' },
  { key: 'listening', label: 'Listening and asking good questions', scenario: 'existing-donor' },
  { key: 'explaining', label: 'Explaining the offer clearly', scenario: 'monthly-giving' },
  { key: 'closing', label: 'Asking for the sale', scenario: 'monthly-giving' },
  { key: 'trust', label: 'Answering tricky questions honestly', scenario: 'sceptical' },
  { key: 'rejection', label: 'Taking a “no” well and moving on', scenario: 'firm-refusal' },
];

export const REP_GOALS: OnboardingOption[] = [
  { key: 'practise-first', label: 'Practise before real customers' },
  { key: 'confidence', label: 'Feel more confident' },
  { key: 'objections', label: 'Get better at objections' },
  { key: 'new-script', label: 'Learn a new campaign or script' },
  { key: 'feedback', label: 'Get honest feedback on how I sound' },
  { key: 'results', label: 'Improve my results' },
];

export const MANAGER_STRUGGLES: OnboardingOption[] = [
  { key: 'ramp-up', label: 'New starters take too long to get going' },
  { key: 'inconsistent', label: 'Everyone pitches differently' },
  { key: 'objections', label: 'Objections lose us sales' },
  { key: 'conversion', label: 'Low conversion' },
  { key: 'compliance', label: 'Mistakes or claims we shouldn’t make' },
  { key: 'confidence', label: 'Reps lack confidence' },
  { key: 'coaching-time', label: 'Not enough time to coach everyone' },
  { key: 'turnover', label: 'Keeping reps motivated and staying' },
];

export const MANAGER_GOALS: OnboardingOption[] = [
  { key: 'onboard-faster', label: 'Get new starters ready faster' },
  { key: 'more-practice', label: 'Give the team more practice' },
  { key: 'see-gaps', label: 'See where each rep needs help' },
  { key: 'roll-out', label: 'Roll out a new campaign or script' },
  { key: 'compliance', label: 'Keep pitches accurate and compliant' },
  { key: 'save-time', label: 'Save time on coaching' },
];

export type OnboardingRole = 'rep' | 'manager';

export function onboardingOptions(role: OnboardingRole) {
  return role === 'rep' ? { struggles: REP_STRUGGLES, goals: REP_GOALS } : { struggles: MANAGER_STRUGGLES, goals: MANAGER_GOALS };
}

export function onboardingLabel(role: OnboardingRole, kind: 'struggles' | 'goals', key: string): string {
  return onboardingOptions(role)[kind].find((o) => o.key === key)?.label ?? key;
}

/** Built-in scenario keys that work on what this rep said they find hard. */
export function suggestedScenarios(struggles: string[] | null | undefined): Set<string> {
  return new Set(REP_STRUGGLES.filter((o) => struggles?.includes(o.key) && o.scenario).map((o) => o.scenario!));
}
