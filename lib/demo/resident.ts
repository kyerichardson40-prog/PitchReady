import type { DrillKey, ScenarioKey } from '../domain/types.ts';
import { repTurns, wordCount, type TranscriptTurn } from '../domain/transcript.ts';
import { P, firstMatch } from './patterns.ts';

export interface DemoResidentReply { utterance: string; endConversation: boolean; reason: string | null }

const say = (utterance: string, end = false, reason: string | null = null): DemoResidentReply => ({ utterance, endConversation: end, reason });

/**
 * Deterministic scripted resident for demo mode. It never claims to be AI and never invents
 * charity facts. Behaviour follows the scenario table in the build pack.
 */
export function demoResidentReply(input: { scenarioKey: ScenarioKey; drillKey: DrillKey | null; transcript: TranscriptTurn[] }): DemoResidentReply {
  const reps = repTurns(input.transcript);
  const last = reps.at(-1)?.text ?? '';
  const n = reps.length;
  if (P.injection.test(last)) return say("Sorry, I'm not sure what you mean by that.", n >= 3, n >= 3 ? 'confused' : null);
  if (P.disengage.test(last) && !P.pitch.test(last)) return say('Thanks. Bye.', true, 'rep_disengaged');
  if (P.pressure.test(last)) return say("I've said what I think. I'm going to go now.", true, 'pressure');

  if (input.drillKey) return drillReply(input.drillKey, last, n);

  switch (input.scenarioKey) {
    case 'busy': {
      if (n === 1) {
        if (wordCount(last) > 45) return say("Sorry, I really have to go.", true, 'time_boundary_ignored');
        if (P.permission.test(last) || P.acknowledge.test(last)) return say('Go on then — quickly.');
        return say("Okay... but I'm in a hurry, what is it exactly?");
      }
      if (wordCount(last) > 45) return say("That's more than I've got time for. Bye.", true, 'time_boundary_ignored');
      if (P.campaignFact.test(last)) return say("Right, got it. I'll think about it, but I need to head off now.", true, 'busy');
      return say("I've got to dash — thanks.", true, 'busy');
    }
    case 'existing-donor': {
      if (P.criticiseOthers.test(last)) return say("I don't appreciate that about the charities I support. I'll leave it there.", true, 'other_charities_criticised');
      if (n === 1) {
        if (P.acknowledge.test(last)) return say('So why would this one matter to me?');
        return say("Like I said, I already give. Why should I add another?");
      }
      if (n === 2) {
        if (P.campaignFact.test(last) || P.purpose.test(last)) return say("Fair enough. I'm not adding another one today, but thanks for explaining.", true, 'declined_politely');
        return say("I'm still not sure what this is for.");
      }
      return say("I'll leave it, thanks.", true, 'declined_politely');
    }
    case 'sceptical': {
      if (firstMatch(last, P.unsupported)) return say("Hmm. I'd want to see that written down somewhere. I'll pass.", true, 'unverified_claim');
      if (n === 1) {
        if (P.identity.test(last) || P.honestUnknown.test(last) || P.purpose.test(last)) return say('Have you got a registration number or anything I can check?');
        return say("That doesn't really answer my question.");
      }
      if (n === 2) {
        if (P.honestUnknown.test(last)) return say("Alright. I appreciate you not making things up. I'll look into it myself.", true, 'honest_answer_accepted');
        return say("I'd still want something I can check. Not today, thanks.", true, 'unverified');
      }
      return say("I'll leave it there, thanks.", true, 'declined_politely');
    }
    case 'monthly-giving': {
      const saysOneOff = P.oneOff.test(last) && !P.negatedOneOff.test(last);
      if (saysOneOff) return say("Oh, just the once? Okay... actually, I'll leave it for today.", true, 'commitment_unclear');
      if (n === 1) {
        if (P.monthly.test(last)) return say('And how would I cancel if I changed my mind?');
        return say("Sorry — so is it monthly or not?");
      }
      if (n === 2) {
        if (P.inventedCancellation.test(last) && !P.honestUnknown.test(last)) return say("Right... I'd want to see that in writing. Not today, thanks.", true, 'unverified_procedure');
        if (P.honestUnknown.test(last)) return say("Okay, that's fair. I'll leave it for now, but thanks for being clear.", true, 'declined_politely');
        return say('Hmm, you didn\'t really say how I\'d cancel.');
      }
      return say("I'll think about it. Thanks.", true, 'declined_politely');
    }
    case 'firm-refusal':
      // Handled by the application layer (residentDirective) — the resident does not reopen the pitch.
      return say('', true, 'boundary_final');
    default:
      return genericReply(last, n);
  }
}

/** Agency-written scenarios have no script: a short, neutral resident (Live AI plays them properly). */
function genericReply(last: string, n: number): DemoResidentReply {
  if (n === 1) {
    if (P.permission.test(last) || P.acknowledge.test(last)) return say('Okay, go on.');
    return say("Sorry, what's this about?");
  }
  if (n === 2) {
    if (P.campaignFact.test(last) || P.purpose.test(last)) return say("Thanks for explaining. I'll think about it.", true, 'declined_politely');
    return say("I'm not sure this is for me.");
  }
  return say("I'll leave it there, thanks.", true, 'declined_politely');
}

function drillReply(drill: DrillKey, last: string, n: number): DemoResidentReply {
  if (n >= 2) return say('Okay. Thanks.', true, 'drill_complete');
  switch (drill) {
    case 'legitimacy':
    case 'money-use':
      if (firstMatch(last, P.unsupported)) return say("I'd need to see that written down.", true, 'unverified_claim');
      return say(P.honestUnknown.test(last) ? 'Fair enough, thanks for being straight with me.' : 'Hmm, okay.', true, 'drill_complete');
    case 'cancellation':
      if (P.inventedCancellation.test(last) && !P.honestUnknown.test(last)) return say("I'd want that in writing.", true, 'unverified_procedure');
      return say('Okay, thanks for checking.', true, 'drill_complete');
    case 'prefers-one-off':
    case 'amount':
      return say(P.monthly.test(last) ? 'Right, monthly. I see.' : "So what is it you're asking for?", P.monthly.test(last), P.monthly.test(last) ? 'drill_complete' : null);
    default:
      return say(P.acknowledge.test(last) ? 'Thanks for understanding.' : 'Okay.', true, 'drill_complete');
  }
}
