import { getDrill } from '../content/scenarios.ts';
import type { Concern, DimensionKey, DimensionResult, DrillKey, EvaluationResult, Evidence, MustSay, RequiredStatementResult, RubricVersion, ScenarioKey } from '../domain/types.ts';
import { wordCount, type TranscriptTurn } from '../domain/transcript.ts';
import { LIMITS } from '../domain/limits.ts';
import { P, excerpt, firstMatch, isGarbled } from './patterns.ts';

export const DEMO_EVALUATOR_VERSION = 'demo-rules-1';
export const DEMO_LIMITATION = 'Demo feedback: produced by transparent keyword rules, not AI. It can miss or misread points.';

type Score = 1 | 2 | 3 | 4 | 5 | null;

interface Ctx {
  transcript: TranscriptTurn[];
  transcriptRevision: number;
  rubric: RubricVersion;
  scenarioKey: ScenarioKey;
  drillKey: DrillKey | null;
  /** The campaign's say rules (published pack). */
  mustSay?: MustSay[];
  neverSay?: string[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Must-say checklist by cue words: the first usable rep turn containing any cue counts as said. */
export function demoRequiredStatements(mustSay: MustSay[], usable: TranscriptTurn[]): RequiredStatementResult[] {
  return mustSay.map((m) => {
    for (const r of usable) {
      for (const cue of m.cues) {
        const re = new RegExp(escapeRe(cue.trim()), 'i');
        if (cue.trim() && re.test(r.text)) return { id: m.id, said: true, evidence: [{ turn_id: r.id, quote: excerpt(r.text, re) }] };
      }
    }
    return { id: m.id, said: false, evidence: [] };
  });
}

/** Never-say phrases by case-insensitive exact match; the quote is the phrase as the rep wrote it. */
export function demoBannedPhrases(neverSay: string[], usable: TranscriptTurn[]): Concern[] {
  const out: Concern[] = [];
  for (const phrase of neverSay) {
    const p = phrase.trim().toLowerCase();
    if (!p) continue;
    const r = usable.find((x) => x.text.toLowerCase().includes(p));
    if (!r) continue;
    const i = r.text.toLowerCase().indexOf(p);
    out.push({ type: 'banned_phrase', explanation: `You used a phrase on your agency's never-say list: "${phrase.trim()}".`, evidence: [{ turn_id: r.id, quote: r.text.slice(i, i + p.length) }], contradicted_fact_id: null });
  }
  return out;
}

const ev = (t: TranscriptTurn, re?: RegExp | null): Evidence => ({ turn_id: t.id, quote: excerpt(t.text, re) });

/** Deterministic "Demo feedback". Output satisfies the same validator as real AI output. */
export function demoEvaluate(ctx: Ctx): EvaluationResult {
  const t = ctx.transcript;
  const reps = t.filter((x) => x.speaker === 'rep' && x.text.trim());
  const usable = reps.filter((r) => !isGarbled(r.text));
  const base = {
    schema_version: '1.1' as const,
    rubric_version: ctx.rubric.version,
    transcript_revision: ctx.transcriptRevision,
  };

  if (usable.length === 0) {
    return {
      ...base,
      dimensions: (['introduction', 'accuracy', 'listening', 'next_step', 'respect'] as const).map((key) => ({
        key, score: null, reason: 'Not observed: there was no usable rep speech to assess.', evidence: [],
      })),
      strength: null, improvement: null, concerns: [],
      required_statements: (ctx.mustSay ?? []).map((m) => ({ id: m.id, said: false, evidence: [] })),
      retry: retryFor(ctx.scenarioKey, ctx.drillKey, null),
      limitations: [DEMO_LIMITATION, reps.length ? 'Rep turns were too short or unclear to assess (possible transcription problem).' : 'No rep turns were recorded.'],
    };
  }

  const prevResident = (turn: TranscriptTurn) => {
    const i = t.findIndex((x) => x.id === turn.id);
    for (let j = i - 1; j >= 0; j--) if (t[j]!.speaker === 'resident') return t[j]!;
    return null;
  };
  const refusalTurn = t.find((x) => x.speaker === 'resident' && P.refusal.test(x.text)) ?? null;
  const refusalIdx = refusalTurn ? t.indexOf(refusalTurn) : -1;
  const repsAfterRefusal = refusalTurn ? usable.filter((r) => t.indexOf(r) > refusalIdx) : [];

  // ---- concerns ----
  const concerns: Concern[] = [];
  const add = (type: Concern['type'], explanation: string, rep: TranscriptTurn, re: RegExp | null, fact: string | null) => {
    const evidence: Evidence[] = [];
    const res = prevResident(rep);
    if (res) evidence.push(ev(res));
    evidence.push(ev(rep, re));
    concerns.push({ type, explanation, evidence, contradicted_fact_id: fact });
  };
  for (const r of usable) {
    const claim = firstMatch(r.text, P.unsupported);
    const res = prevResident(r);
    if (claim) add('unsupported_campaign_claim', 'Possible claim not in the approved facts (for example an impact figure, registration detail or partnership). Approved guidance is to say you need to check.', r, claim, 'F5');
    else if (res && P.cancellationAsk.test(res.text) && P.inventedCancellation.test(r.text) && !P.honestUnknown.test(r.text)) {
      add('unsupported_campaign_claim', 'Possible invented cancellation procedure; the approved pack does not supply one.', r, P.inventedCancellation, 'F5');
    }
    if (P.oneOff.test(r.text) && !P.negatedOneOff.test(r.text)) add('misstated_commitment', 'The approved campaign invites an optional monthly gift; this may describe it as one-off.', r, P.oneOff, 'F2');
    if (/\b(you (?:have|need) to|must) (?:donate|give|sign)/i.test(r.text)) add('misstated_commitment', 'May suggest that giving is required; the approved facts say a donation is voluntary.', r, /(have|need|must)/i, 'F3');
    if (P.injection.test(r.text)) add('other_review_needed', 'Rep text appears to address the practice system or scoring rather than the resident. Scores ignore it; a manager may want to check.', r, P.injection, null);
    if (P.criticiseOthers.test(r.text)) add('other_review_needed', "May criticise the resident's existing charities.", r, P.criticiseOthers, null);
  }
  for (const r of repsAfterRefusal) {
    if ((P.pitch.test(r.text) || P.pressure.test(r.text)) && !(P.disengage.test(r.text) && !P.pitch.test(r.text))) {
      add('ignored_stop_request', 'The resident asked to stop, and this turn appears to continue the pitch.', r, P.pitch.test(r.text) ? P.pitch : P.pressure, 'F3');
      break;
    }
  }
  const has = (type: Concern['type']) => concerns.some((c) => c.type === type);
  const concernRep = (type: Concern['type']) => concerns.find((c) => c.type === type)!.evidence;

  const dims: DimensionResult[] = [];
  const dim = (key: DimensionKey, score: Score, reason: string, evidence: Evidence[]) => dims.push({ key, score, reason, evidence: score === null ? evidence.slice(0, 2) : evidence.slice(0, 4) });

  // ---- introduction ----
  const r1 = usable[0]!;
  const boundaryOpen = refusalTurn !== null && refusalIdx === 0;
  if (ctx.drillKey) dim('introduction', null, 'Not observed: drills start mid-conversation.', []);
  else if (boundaryOpen && !P.purpose.test(r1.text) && !P.identity.test(r1.text)) dim('introduction', null, 'Not observed: the resident refused before an introduction was appropriate.', []);
  else {
    const id = P.identity.test(r1.text), pu = P.purpose.test(r1.text), perm = P.permission.test(r1.text);
    let s: Score = id && pu ? 3 : id || pu ? 2 : 1;
    if (s === 3 && perm) s = wordCount(r1.text) <= 40 ? 5 : 4;
    const why = s === 5 ? 'Stated who you are and why you are here concisely, and asked for permission.'
      : s === 4 ? 'Clear identity and purpose with a permission check, but on the long side.'
      : s === 3 ? 'Stated identity and purpose clearly.'
      : s === 2 ? 'Only part of who you are and why you are visiting came across.'
      : 'Your identity and purpose were not clear in the opening.';
    dim('introduction', s, why, [ev(r1, P.permission.test(r1.text) ? P.permission : P.identity)]);
  }

  // ---- accuracy ----
  const factTurns = usable.filter((r) => P.campaignFact.test(r.text));
  const honest = usable.filter((r) => P.honestUnknown.test(r.text));
  if (has('unsupported_campaign_claim') || has('misstated_commitment')) {
    const c = concerns.find((x) => x.type === 'unsupported_campaign_claim' || x.type === 'misstated_commitment')!;
    dim('accuracy', 1, 'Possible material claim that is not supported by the approved facts.', c.evidence);
  } else if (!factTurns.length && !honest.length) {
    dim('accuracy', null, 'Not observed: the campaign was not explained in this exchange.', []);
  } else {
    let s: Score = 3;
    const voluntary = usable.some((r) => P.voluntary.test(r.text));
    if (factTurns.length && voluntary) s = 4;
    if (s === 4 && usable.some((r) => P.understandingCheck.test(r.text))) s = 5;
    const evidence = [...factTurns.slice(0, 1).map((r) => ev(r, P.campaignFact)), ...honest.slice(0, 1).map((r) => ev(r, P.honestUnknown))];
    const why = s === 5 ? 'Accurate, voluntary explanation with a check that it made sense.'
      : s === 4 ? 'Stayed within approved facts and made clear the gift is optional.'
      : honest.length && !factTurns.length ? 'Handled an unknown honestly rather than guessing.' : 'Stayed within the approved facts.';
    dim('accuracy', s, why, evidence);
  }

  // ---- listening ----
  let worst: { s: 1 | 2 | 3 | 4 | 5; res: TranscriptTurn; rep: TranscriptTurn; why: string } | null = null;
  for (const r of usable) {
    const res = prevResident(r);
    if (!res) continue;
    const wc = wordCount(r.text);
    const ack = P.acknowledge.test(r.text);
    let s: 1 | 2 | 3 | 4 | 5; let why: string;
    if ((P.refusal.test(res.text) || P.busy.test(res.text)) && P.pitch.test(r.text) && (wc > 45 || P.pressure.test(r.text) || P.refusal.test(res.text))) { s = 1; why = "Continued the pitch instead of responding to the resident's time or boundary."; }
    else if (P.criticiseOthers.test(r.text)) { s = 1; why = "Argued with the resident's point instead of acknowledging it."; }
    else if (ack && wc <= 40) { s = 5; why = 'Acknowledged what the resident said and answered concisely.'; }
    else if (ack && wc <= 60) { s = 4; why = 'Acknowledged the resident and responded relevantly.'; }
    else if (wc > 60) { s = 2; why = 'The response was long for what the resident asked.'; }
    else { s = 3; why = "Responded to the resident's point, without explicitly acknowledging it."; }
    if (!worst || s < worst.s) worst = { s, res, rep: r, why };
  }
  if (worst) dim('listening', worst.s, worst.why, [ev(worst.res), ev(worst.rep, worst.s >= 4 ? P.acknowledge : null)]);
  else dim('listening', null, 'Not observed: no rep response to a resident turn.', []);

  // ---- next step ----
  const pressureTurn = usable.find((r) => P.pressure.test(r.text));
  const firstAfterRefusal = repsAfterRefusal[0];
  if (has('ignored_stop_request') || pressureTurn || has('misstated_commitment')) {
    const e = pressureTurn ? [ev(pressureTurn, P.pressure)] : concernRep(has('ignored_stop_request') ? 'ignored_stop_request' : 'misstated_commitment');
    dim('next_step', 1, 'The next step involved pressure or an inaccurate commitment.', e);
  } else if (firstAfterRefusal && P.disengage.test(firstAfterRefusal.text)) {
    dim('next_step', 5, "Ended the conversation, matching the resident's wishes.", [ev(refusalTurn!), ev(firstAfterRefusal, P.disengage)]);
  } else {
    const offer = usable.find((r) => P.nextStepOffer.test(r.text) || P.voluntary.test(r.text));
    const confirm = usable.find((r) => P.confirm.test(r.text));
    const ending = usable.find((r) => P.disengage.test(r.text));
    if (offer) {
      const s: Score = confirm ? 5 : P.voluntary.test(offer.text) && P.nextStepOffer.test(offer.text) ? 4 : 3;
      dim('next_step', s, s === 5 ? 'Offered a voluntary next step and checked it suited the resident.' : 'Offered a clear, voluntary next step.', [ev(offer, P.nextStepOffer.test(offer.text) ? P.nextStepOffer : P.voluntary), ...(confirm && confirm !== offer ? [ev(confirm, P.confirm)] : [])]);
    } else if (ending) dim('next_step', 3, 'Ended the conversation courteously.', [ev(ending, P.disengage)]);
    else dim('next_step', null, 'Not observed: no next step or ending was reached.', []);
  }

  // ---- respect ----
  if (has('ignored_stop_request')) dim('respect', 1, 'Continued after a clear request to stop.', concernRep('ignored_stop_request'));
  else if (firstAfterRefusal && P.disengage.test(firstAfterRefusal.text)) dim('respect', 5, 'Accepted the boundary immediately and stayed courteous.', [ev(refusalTurn!), ev(firstAfterRefusal, P.disengage)]);
  else if (pressureTurn || usable.some((r) => P.criticiseOthers.test(r.text))) {
    const r = pressureTurn ?? usable.find((x) => P.criticiseOthers.test(x.text))!;
    dim('respect', 2, 'Polite in places, but applied pressure or argued.', [ev(r, pressureTurn ? P.pressure : P.criticiseOthers)]);
  } else {
    const vol = usable.find((r) => P.voluntary.test(r.text));
    const courteous = usable.find((r) => P.acknowledge.test(r.text) || P.disengage.test(r.text));
    if (vol) dim('respect', 4, 'Courteous, and made clear that declining is fine.', [ev(vol, P.voluntary)]);
    else if (courteous) dim('respect', 3, 'Courteous throughout.', [ev(courteous, P.acknowledge.test(courteous.text) ? P.acknowledge : P.disengage)]);
    else dim('respect', null, 'Not observed: no boundary or courtesy marker to assess.', []);
  }

  // ---- strength / improvement / retry ----
  const scored = dims.filter((d) => d.score !== null) as (DimensionResult & { score: 1 | 2 | 3 | 4 | 5 })[];
  const repEvidenceIds = (d: DimensionResult) => [...new Set(d.evidence.filter((e) => e.turn_id.startsWith('rep-')).map((e) => e.turn_id))];
  const best = [...scored].sort((a, b) => b.score - a.score)[0];
  const priority: DimensionKey[] = ['respect', 'accuracy', 'listening', 'next_step', 'introduction'];
  const weakest = [...scored].filter((d) => d.score <= 3).sort((a, b) => a.score - b.score || priority.indexOf(a.key) - priority.indexOf(b.key))[0];
  const strength = best && best.score >= 3 && best !== weakest ? { text: strengthText(best.key, best.reason), turn_ids: repEvidenceIds(best) } : null;
  const tip = weakest ? ctx.rubric.dimensions.find((d) => d.key === weakest.key)?.improvementTip ?? weakest.reason : null;
  const improvement = weakest && tip ? { text: tip, turn_ids: repEvidenceIds(weakest) } : null;

  const limitations = [DEMO_LIMITATION];
  if (usable.length < 2) limitations.push('Only a short exchange was observed.');
  if (dims.some((d) => d.score === null)) limitations.push('Some dimensions were not observed in this conversation.');

  return {
    ...base,
    dimensions: dims,
    strength: strength && strength.turn_ids.length ? strength : null,
    improvement: improvement && improvement.turn_ids.length ? improvement : null,
    concerns: [...concerns, ...demoBannedPhrases(ctx.neverSay ?? [], usable)].slice(0, 6),
    required_statements: demoRequiredStatements(ctx.mustSay ?? [], usable),
    retry: retryFor(ctx.scenarioKey, ctx.drillKey, weakest?.key ?? null),
    limitations,
  };
}

function strengthText(key: DimensionKey, reason: string): string {
  const lead: Record<DimensionKey, string> = {
    introduction: 'Your opening worked:', accuracy: 'You kept to the facts:', listening: 'You listened well:',
    next_step: 'Your next step was well judged:', respect: 'You handled the boundary well:',
  };
  return `${lead[key]} ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`;
}

const LISTENING_DRILL: Record<string, DrillKey> = {
  busy: 'busy', 'existing-donor': 'already-donate', sceptical: 'legitimacy', 'monthly-giving': 'cancellation', 'firm-refusal': 'not-interested',
};

export function retryFor(scenarioKey: ScenarioKey, drillKey: DrillKey | null, weak: DimensionKey | null): EvaluationResult['retry'] {
  // Agency-written scenarios have no drills: the retry is another go at the same scenario.
  if (!LISTENING_DRILL[scenarioKey]) {
    return { objective: 'Try this scenario again, focusing on the priority improvement above.', scenario_key: scenarioKey, drill_key: null, max_seconds: LIMITS.drillSeconds };
  }
  let key: DrillKey;
  switch (weak) {
    case 'respect': key = 'asks-to-end'; break;
    case 'accuracy': key = scenarioKey === 'monthly-giving' ? 'cancellation' : 'money-use'; break;
    case 'next_step': key = scenarioKey === 'firm-refusal' ? 'asks-to-end' : 'amount'; break;
    case 'introduction': key = 'busy'; break;
    case 'listening': key = LISTENING_DRILL[scenarioKey]!; break;
    default: key = drillKey ?? LISTENING_DRILL[scenarioKey]!;
  }
  const d = getDrill(key)!;
  return { objective: d.objective, scenario_key: d.baseScenario, drill_key: d.key, max_seconds: LIMITS.drillSeconds };
}
