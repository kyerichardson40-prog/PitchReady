'use client';
import { useState } from 'react';
import { useApp } from '../app-context.tsx';
import { useLocation, useNavigate } from '../router.tsx';
import { onboardingApi } from '../repo/api-repo.ts';
import { ErrorBox, Loading } from '../components/ui.tsx';
import { onboardingOptions, type OnboardingOption, type OnboardingRole } from '../../../lib/content/onboarding.ts';

/** Choices shown as tappable chips (toggle buttons). */
function Chips({ options, value, onChange, label }: { options: OnboardingOption[]; value: string[]; onChange: (v: string[]) => void; label: string }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((o) => {
        const on = value.includes(o.key);
        return (
          <button key={o.key} type="button" className={`chip ${on ? 'on' : ''}`} aria-pressed={on}
            onClick={() => onChange(on ? value.filter((k) => k !== o.key) : [...value, o.key])}>
            <span className="chip-tick" aria-hidden="true">{on ? '✓' : '+'}</span>{o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Welcome questions, shown once after someone creates their account: what they (or their team)
 * find hard, and what they want PitchReady to help with. Reps' answers are visible to their
 * manager; everyone's to the PitchReady owner.
 */
export function WelcomePage() {
  const { ctx, refresh } = useApp();
  const navigate = useNavigate();
  const { search } = useLocation();
  const next = new URLSearchParams(search).get('next');
  const knownRole: OnboardingRole | null = ctx?.hasTeam && ctx.user ? (ctx.user.role === 'manager' ? 'manager' : 'rep') : null;
  const [role, setRole] = useState<OnboardingRole | null>(knownRole);
  const [step, setStep] = useState<0 | 1 | 2>(knownRole ? 1 : 0);
  const [struggles, setStruggles] = useState<string[]>([]);
  const [strugglesOther, setStrugglesOther] = useState('');
  const [goals, setGoals] = useState<string[]>([]);
  const [goalsOther, setGoalsOther] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!ctx?.user) return <Loading />;

  const destination = (r: OnboardingRole) => {
    if (next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/welcome')) return next;
    if (!ctx.hasTeam) return r === 'manager' && ctx.canStartPilot ? '/start' : '/practice';
    return r === 'manager' ? '/manager' : '/practice';
  };
  const finish = async (skipped: boolean) => {
    const r = role ?? knownRole ?? 'rep';
    setBusy(true); setErr(null);
    try {
      await onboardingApi.save(skipped ? { role: r, struggles: [], goals: [], skipped: true }
        : { role: r, struggles, strugglesOther: strugglesOther.trim() || undefined, goals, goalsOther: goalsOther.trim() || undefined });
      await refresh();
      navigate(destination(r), { replace: true });
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };

  const firstName = (ctx.user.name ?? '').split(' ')[0];
  const opts = role ? onboardingOptions(role) : null;
  const team = role === 'manager';
  const total = knownRole ? 2 : 3;
  const shown = knownRole ? step : step + 1;

  return (
    <div className="stack narrow welcome">
      <p className="welcome-step">Step {shown} of {total}</p>
      {err && <ErrorBox message={err} />}

      {step === 0 && (
        <section className="card" aria-labelledby="w-role">
          <h1 id="w-role">Welcome{firstName && firstName !== ctx.user.email ? `, ${firstName}` : ''}! How will you use PitchReady?</h1>
          <div className="welcome-roles">
            <button type="button" className="welcome-role" onClick={() => { setRole('manager'); setStep(1); }}>
              <strong>I run a sales team</strong><span>I want my team to practise and see where they need help.</span>
            </button>
            <button type="button" className="welcome-role" onClick={() => { setRole('rep'); setStep(1); }}>
              <strong>I’m a sales rep</strong><span>I want to practise my pitch. My manager has invited me, or will.</span>
            </button>
          </div>
        </section>
      )}

      {step === 1 && opts && (
        <section className="card" aria-labelledby="w-struggle">
          <h1 id="w-struggle">{team ? 'What is your team struggling with?' : 'What do you find hardest?'}</h1>
          <p className="muted">Pick as many as you like. {team ? 'It helps us set PitchReady up around your team.' : 'We’ll suggest practice that works on it.'}</p>
          <Chips label={team ? 'What your team struggles with' : 'What you find hardest'} options={opts.struggles} value={struggles} onChange={setStruggles} />
          <div className="field"><label htmlFor="w-s-other">Anything else? (optional)</label>
            <textarea id="w-s-other" rows={2} maxLength={500} value={strugglesOther} onChange={(e) => setStrugglesOther(e.target.value)} placeholder={team ? 'For example: our new campaign has lots of questions about price' : 'For example: I go blank when people ask about the price'} /></div>
          <div className="row">
            <button className="btn primary" onClick={() => setStep(2)}>Next</button>
            {!knownRole && <button className="btn" onClick={() => setStep(0)}>Back</button>}
          </div>
        </section>
      )}

      {step === 2 && opts && (
        <section className="card" aria-labelledby="w-goal">
          <h1 id="w-goal">What do you want PitchReady to help {team ? 'your team' : 'you'} with?</h1>
          <p className="muted">Pick as many as you like.</p>
          <Chips label="What you want help with" options={opts.goals} value={goals} onChange={setGoals} />
          <div className="field"><label htmlFor="w-g-other">Anything else? (optional)</label>
            <textarea id="w-g-other" rows={2} maxLength={500} value={goalsOther} onChange={(e) => setGoalsOther(e.target.value)} /></div>
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={() => void finish(false)}>{busy ? 'Saving…' : 'Finish'}</button>
            <button className="btn" disabled={busy} onClick={() => setStep(1)}>Back</button>
          </div>
        </section>
      )}

      <p className="small muted">
        {role === 'rep' && knownRole ? 'Your manager can see your answers, so they know where to help. ' : ''}
        <button className="btn link" disabled={busy} onClick={() => void finish(true)}>Skip for now</button>
      </p>
    </div>
  );
}
