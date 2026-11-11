/**
 * Helpers for speaking the AI customer's reply while it is still being written.
 *
 * The model returns JSON ({"utterance": "...", "endConversation": …}). `utteranceSoFar` reads the
 * utterance out of a partial JSON text; `nextSpeakableEnd` finds where the next whole sentence
 * ends, so each sentence can be sent for speech as soon as it is complete.
 */

/** The (possibly unfinished) value of "utterance" in a partial JSON text, decoded. */
export function utteranceSoFar(json: string): string {
  const m = /"utterance"\s*:\s*"/.exec(json);
  if (!m) return '';
  let out = '';
  for (let i = m.index + m[0].length; i < json.length; i++) {
    const c = json[i]!;
    if (c === '"') return out;
    if (c !== '\\') { out += c; continue; }
    const n = json[i + 1];
    if (n === undefined) return out; // escape split across chunks: wait for more
    if (n === 'u') {
      const hex = json.slice(i + 2, i + 6);
      if (hex.length < 4) return out;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
      continue;
    }
    out += ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' } as Record<string, string>)[n] ?? n;
    i += 1;
  }
  return out;
}

/**
 * End index (exclusive) of the next speakable chunk of `text` starting at `from`, or null if no
 * sentence has finished yet. The first chunk is sent as soon as any sentence ends (fastest start);
 * later ones wait for at least ~25 characters so the voice isn't chopped into tiny pieces.
 */
export function nextSpeakableEnd(text: string, from: number, first: boolean): number | null {
  const rest = text.slice(from);
  const re = /[.!?…]+["'”’)]*\s+/g;
  let end: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest))) {
    const e = m.index + m[0].length;
    if (e >= (first ? 4 : 25)) { end = from + e; if (first) break; }
  }
  return end;
}

/** Splits a finished utterance into the same chunks (used when the reply wasn't streamed). */
export function speakableChunks(text: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (let end = nextSpeakableEnd(text, 0, true); end !== null; end = nextSpeakableEnd(text, from, false)) {
    out.push(text.slice(from, end).trim());
    from = end;
  }
  const rest = text.slice(from).trim();
  if (rest) out.push(rest);
  return out.filter(Boolean);
}
