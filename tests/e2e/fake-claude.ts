/**
 * A stand-in for claude.ai's `window.claude` + `sample` capability, injected into the standalone
 * demo in tests. Answers are built from the prompt's DATA block (so a passing test also shows the
 * prompt carried the transcript and rubric). `mode`: 'ok' | 'deny' (consent refused).
 */
export function fakeClaudeScript(mode: 'ok' | 'deny', evalDelayMs = 800): string {
  return `(() => {
  const calls = []; window.__claudeCalls = calls;
  const dataOf = (t) => JSON.parse(t.slice(t.indexOf('\\n', t.indexOf('DATA (JSON')) + 1));
  const json = async (messages, opts) => {
    calls.push({ tier: opts && opts.modelTier, turns: messages.length });
    if (${JSON.stringify(mode)} === 'deny') throw { code: 'not_granted', message: 'Viewer declined.' };
    const data = dataOf(messages[0].content);
    if (data.TASK) return { utterance: 'Live AI resident: go on, but be quick.', endConversation: false, reason: null };
    await new Promise((r) => setTimeout(r, ${evalDelayMs}));
    const rep = data.TRANSCRIPT_UNTRUSTED.find((t) => t.speaker === 'rep');
    return {
      schema_version: '1.1', rubric_version: data.RUBRIC_VERSION, transcript_revision: data.TRANSCRIPT_REVISION,
      required_statements: data.APPROVED_CAMPAIGN.must_say.map((m) => ({ id: m.id, said: false, evidence: [] })),
      dimensions: data.RUBRIC.map((d, i) => i === 0
        ? { key: d.key, score: 4, reason: 'Live AI: clear, friendly opening.', evidence: [{ turn_id: rep.turn_id, quote: rep.text.slice(0, 20) }] }
        : { key: d.key, score: null, reason: 'Not observed in this short practice.', evidence: [] }),
      strength: { text: 'Live AI strength: a friendly, clear opening.', turn_ids: [rep.turn_id] }, improvement: null, concerns: [],
      retry: { objective: 'Practise a ten-second introduction.', scenario_key: data.SCENARIO.key, drill_key: null, max_seconds: 60 },
      limitations: ['Stubbed Claude in tests.'],
    };
  };
  window.claude = { use: async (name) => (name === 'sample' ? { json } : null) };
})();`;
}
