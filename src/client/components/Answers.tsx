import { onboardingOptions, type OnboardingRole } from '../../../lib/content/onboarding.ts';

export interface Answer { name?: string | null; email?: string; team?: string | null; role: OnboardingRole; struggles: string[]; strugglesOther: string | null; goals: string[]; goalsOther: string | null; at: string }

/** How many people picked each option, most first (only options someone picked). */
export function AnswerCounts({ answers, role, kind, title }: { answers: Answer[]; role: OnboardingRole; kind: 'struggles' | 'goals'; title: string }) {
  const people = answers.filter((a) => a.role === role);
  const counts = onboardingOptions(role)[kind].map((o) => ({ ...o, n: people.filter((a) => a[kind].includes(o.key)).length })).filter((o) => o.n > 0).sort((a, b) => b.n - a.n);
  if (counts.length === 0) return null;
  const max = counts[0]!.n;
  return (
    <div className="answer-counts">
      <h3>{title}</h3>
      <ul>{counts.map((o) => (
        <li key={o.key}><span className="answer-label">{o.label}</span><span className="answer-bar" aria-hidden="true"><span style={{ width: `${(o.n / max) * 100}%` }} /></span><span className="answer-n">{o.n}</span></li>
      ))}</ul>
    </div>
  );
}

/** Things people wrote in their own words. */
export function AnswerQuotes({ answers, limit = 8, who }: { answers: Answer[]; limit?: number; who: (a: Answer) => string }) {
  const quotes = answers.flatMap((a) => [a.strugglesOther, a.goalsOther].filter((t): t is string => !!t).map((text) => ({ text, a }))).slice(0, limit);
  if (quotes.length === 0) return null;
  return (
    <div className="answer-quotes">
      <h3>In their own words</h3>
      <ul>{quotes.map((q, i) => <li key={i}><blockquote>“{q.text}”</blockquote><span className="small muted">{who(q.a)}</span></li>)}</ul>
    </div>
  );
}
