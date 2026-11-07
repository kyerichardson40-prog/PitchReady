/**
 * Keyword heuristics used ONLY by the deterministic demo resident and "Demo feedback" evaluator.
 * They are deliberately simple and transparent; they are not AI and not a quality judgement.
 */
export const P = {
  identity: /\b(i'?m|i am|my name(?:'s| is))\s+[A-Z]?[a-z]+/i,
  purpose: /\b(neighbourhood meal project|meal project|community meal|charity|fundrais|on behalf of|campaign|project)\b/i,
  permission: /\b(have you got|got a (?:moment|minute|sec)|is now (?:a )?(?:ok|okay|good)|a quick|a moment|a minute|ten seconds|30 seconds|is that ok|would you mind|do you have (?:a )?(?:moment|minute|time))\b/i,
  fictional: /\bfictional\b/i,
  campaignFact: /(£\s?10|ten pounds|\bmonthly\b|every month|community meal|meal sessions?|optional|voluntary)/i,
  monthly: /\b(monthly|every month|each month|a month)\b/i,
  voluntary: /\b(optional|voluntary|completely fine|totally fine|no pressure|no obligation|up to you|fine to (?:say no|decline)|okay to (?:say no|decline)|don't have to)\b/i,
  honestUnknown: /\b(need to check|i'?d have to check|i'?ll have to check|don'?t have (?:approved |that |the )?(?:information|info|details)|not sure,? so i|rather than guess|i can'?t say for certain|i don'?t know)\b/i,
  understandingCheck: /\b(does that make sense|is that clear|any questions|does that answer|did that make sense|is that helpful|make sense\?)/i,
  acknowledge: /\b(i understand|understand|that'?s (?:fair|great|really good|kind|fine|good)|fair enough|of course|i appreciate|appreciate|totally|completely understand|no problem|no worries|thanks for|thank you|good question|i hear you|sure|absolutely|lovely|that'?s brilliant)\b/i,
  disengage: /\b(thanks for your time|thank you for your time|leave you to it|have a (?:good|nice|lovely|great)|take care|enjoy your|no problem|sorry to bother|i'?ll let you go|i'?ll go|bye|all the best)\b/i,
  pitch: /(£|\bpounds?\b|donat|\bgift\b|\bmonthly\b|sign up|\bspare\b|let me (?:finish|explain|just)|\bsurely\b|only takes|just (?:a|one) (?:minute|second))/i,
  pressure: /\b(surely|you (?:have|need) to|must (?:donate|give|sign)|everyone (?:else )?(?:on this street )?(?:is|has)|don'?t you (?:want|care)|only takes|it'?s just|let me finish|just hear me out|you can afford|come on)\b/i,
  nextStepOffer: /\b(would you like|if you'?re interested|would you be (?:open|interested)|shall i|happy to|i can (?:leave|explain|give)|want me to|could i|would it help|if you want)\b/i,
  confirm: /\b(does that sound (?:ok|okay|alright|fair|good)|would that work|is that ok|is that alright|does that work)\b/i,
  oneOff: /\b(one[- ]off|just once|single (?:donation|payment|gift)|only once)\b/i,
  negatedOneOff: /\b(not (?:a |just a )?one[- ]off|isn'?t (?:a )?one[- ]off|rather than (?:a )?one[- ]off|not just once)\b/i,
  unsupported: [
    /\b(100\s?%|one hundred per ?cent|every (?:single )?(?:penny|pound|donation)|all (?:of )?(?:the |your |every )?(?:money|donations?|funds)) (?:goes|go|reaches|reach|is spent)/i,
    /\b(registration number|charity number|registered (?:charity )?(?:no\.?|number))\s*(?:is\s*)?\d/i,
    /\b\d{6,8}\b/,
    /\b\d+\s*meals? (?:for|per) (?:every )?(?:£|pound)/i,
    /\b(£\s?\d+|ten pounds|a tenner) (?:buys|pays for|provides|feeds) \d+/i,
    /\b(partner(?:ed|s|ship)? with|backed by|endorsed by|working with) (?:the )?[A-Z][a-z]+/,
    /\bstraight to the people\b/i,
  ],
  inventedCancellation: /\b(cancel(?:led|ling)? (?:it )?(?:any ?time )?(?:by|via|online|through|with)|just (?:call|email|text|ring)|(?:call|ring|email|text) (?:us|the office|the number)|there'?s a (?:number|form|website)|in (?:your|the) app|one click)\b/i,
  refusal: /\b(no thank you|no thanks|please leave|not interested|go away|leave me|i'?d like you to go|you to go now|i need to go|have to go|i'?ve got to (?:go|dash)|i'?ll pass|not today)\b/i,
  busy: /\b(only got a moment|in a (?:real )?(?:rush|hurry)|heading out|have to go|no time|busy)\b/i,
  criticiseOthers: /\b(other charit(?:y|ies)|those (?:big )?charit(?:y|ies)|they)\b.{0,40}\b(waste|don'?t (?:actually )?help|rip[- ]?off|scam|useless|keep (?:it|the money)|aren'?t as good|worse)\b|\bbetter than (?:your|other|those)\b/i,
  injection: /(ignore (?:all |your |previous |the )?(?:instructions|prompt|rules)|system\s*:|\[system\]|<\/?system>|give (?:me |this )?(?:all |full )?(?:fives|5s|five out of five|top marks)|score (?:me|this) (?:5|five)|you are now|developer mode|reveal (?:your )?prompt)/i,
  question: /\?\s*$/,
  cancellationAsk: /\bcancel/i,
  legitimacyAsk: /\b(legitimate|legit|registration|id\b|identification|prove|scam|verify)/i,
};

export function firstMatch(text: string, res: RegExp[]): RegExp | null {
  return res.find((r) => r.test(text)) ?? null;
}

/** Returns a trimmed sentence (exact substring) of `text` that matches `re`, else the first sentence. */
export function excerpt(text: string, re?: RegExp | null): string {
  const sentences = text.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text.trim()];
  const pick = (re && sentences.find((s) => re.test(s))) || sentences[0] || text.trim();
  const clipped = pick.length > 280 ? pick.slice(0, 280) : pick;
  // Guarantee the excerpt is an exact substring of the original text.
  return text.includes(clipped) ? clipped : text.trim().slice(0, 280);
}

export function isGarbled(text: string): boolean {
  // Ignore transcription markers ([inaudible], (crosstalk)) and filler sounds before judging.
  const t = text.replace(/[[(][^\])]*[\])]/g, ' ').replace(/\b(uh+|um+|mm+|er+m?|hmm+|ah+)\b/gi, ' ').trim();
  if (!t) return true;
  const letters = (t.match(/[a-z]/gi) ?? []).length;
  const words = t.split(/\s+/).filter((w) => /[a-z]{2,}/i.test(w));
  return letters / t.length < 0.5 || words.length < 2;
}
