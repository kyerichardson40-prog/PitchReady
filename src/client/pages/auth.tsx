'use client';
import { useEffect, useState } from 'react';
import { useApp } from '../app-context.tsx';
import { Link, useNavigate, useLocation } from '../router.tsx';
import { auth } from '../repo/api-repo.ts';
import { ErrorBox, Loading } from '../components/ui.tsx';

export function LoginPage() {
  const navigate = useNavigate();
  const { repo, ctx, refresh } = useApp();
  const { search } = useLocation();
  const qs = new URLSearchParams(search);
  const next = qs.get('next') ?? '';
  const [mode, setMode] = useState<'in' | 'up' | 'forgot'>(qs.get('signup') ? 'up' : 'in');
  const [email, setEmail] = useState(qs.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(qs.get('signedOut') ? 'You have signed out.' : null);

  // Supabase email links return tokens or errors in the URL fragment.
  useEffect(() => {
    if (repo.mode !== 'connected' || !location.hash) return;
    const h = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, '', location.pathname + location.search);
    if (h.get('error_code') === 'otp_expired' || h.get('error')) {
      setErr(h.get('error_code') === 'otp_expired' ? 'That email link has expired or was already used. Sign in, or sign up again to get a new confirmation email.' : (h.get('error_description') ?? 'That link could not be used.'));
      return;
    }
    const at = h.get('access_token'), rt = h.get('refresh_token');
    if (at && rt) {
      setBusy(true);
      const recovery = h.get('type') === 'recovery';
      auth.adoptSession(at, rt).then(async () => {
        await refresh();
        if (recovery) { navigate('/settings?reset=1', { replace: true }); return; }
        setInfo('Email confirmed. You are signed in.'); navigate(next || '/practice', { replace: true });
      })
        .catch((e) => setErr(e.message)).finally(() => setBusy(false));
    }
  }, [repo.mode, refresh, next, navigate]);

  if (repo.mode === 'demo') return <DemoSignIn role={qs.get('role') === 'manager' ? 'manager' : 'rep'} next={next} />;
  if (ctx?.user) {
    return (
      <div className="stack">
        <h1>You’re signed in</h1>
        <p>{ctx.user.email}</p>
        {!ctx.hasTeam && ctx.canStartPilot && <div className="alert info">You’re not in a team yet. <Link to="/start">Start a free pilot for your team</Link>, or open the invitation link your manager sent you.</div>}
        <div className="row">
          <button className="btn primary" onClick={() => navigate(next || (ctx.user!.role === 'manager' ? '/manager' : '/practice'))}>Continue</button>
          <button className="btn" onClick={async () => { await auth.signOut(); await refresh(); setInfo('You have signed out.'); }}>Sign out</button>
        </div>
      </div>
    );
  }
  return (
    <div className="stack" style={{ maxWidth: 440 }}>
      <h1>{mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create your account' : 'Reset your password'}</h1>
      {info && <div className="alert info" role="status">{info}</div>}
      {err && <ErrorBox message={err} />}
      <form className="card" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr(null); setInfo(null);
        try {
          if (mode === 'in') { await auth.signIn(email, password); await refresh(); navigate(next || '/practice'); }
          else if (mode === 'forgot') {
            await auth.forgotPassword(email);
            setInfo('If there’s an account for that email, we’ve sent a link to reset the password. It can take a few minutes; check your spam folder too.');
          }
          else {
            const r = await auth.signUp(email, password);
            if (r.confirmationRequired) setInfo('Check your email for a confirmation link. After confirming, you’ll be signed in. If you were invited, open your invitation link again.');
            else { await refresh(); navigate(next || '/practice'); }
          }
        } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
      }}>
        <div className="field"><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        {mode === 'forgot' ? <p className="small muted">Enter the email you signed up with and we’ll send you a link to choose a new password.</p> : (
        <div className="field"><label htmlFor="pw">Password</label><input id="pw" type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} minLength={mode === 'up' ? 10 : 1} required value={password} onChange={(e) => setPassword(e.target.value)} />
          {mode === 'up' && <p className="hint">At least 10 characters.</p>}
          {mode === 'in' && <p className="hint"><button type="button" className="btn link" onClick={() => { setMode('forgot'); setErr(null); setInfo(null); }}>Forgot your password?</button></p>}</div>
        )}
        {mode === 'up' && (
          <div className="field">
            <label className="check">
              <input type="checkbox" required checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              <span>I agree to the <Link to="/terms">Terms and conditions</Link> and have read the <Link to="/privacy">Privacy notice</Link>.</span>
            </label>
          </div>
        )}
        <button className="btn primary" type="submit" disabled={busy} style={{ width: '100%' }}>{busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}</button>
      </form>
      <p className="small">{mode === 'in' ? <>No account yet? <button className="btn link" onClick={() => setMode('up')}>Create an account</button></> : <>{mode === 'up' ? 'Already have an account?' : 'Remembered it?'} <button className="btn link" onClick={() => setMode('in')}>Sign in</button></>}</p>
      <p className="small muted">{ctx?.pilotsOpen ? 'Joining a team? Use the email address your invitation was sent to. Setting up your own team? Create an account, then start a free pilot.' : 'Accounts are for invited team members. Creating an account on its own does not give access.'}</p>
    </div>
  );
}

/** Start a free pilot: a signed-in person with no team creates one and becomes its manager. */
export function StartPilotPage() {
  const navigate = useNavigate();
  const { repo, ctx, refresh } = useApp();
  const [team, setTeam] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!ctx?.user) return <Loading />;
  if (repo.mode === 'demo') return <div className="stack narrow"><h1>Start a free pilot</h1><div className="alert info">This is the demo. On the live PitchReady site you can create your own team here.</div></div>;
  if (ctx.hasTeam) return <div className="stack narrow"><h1>You’re already in a team</h1><p>{ctx.agencyName}</p><Link className="btn primary" to={ctx.user.role === 'manager' ? '/manager' : '/practice'}>Continue</Link></div>;
  if (!ctx.canStartPilot) return <div className="stack narrow"><h1>Start a pilot</h1><p>New pilots are by arrangement at the moment. <Link to="/contact">Contact us</Link> and we’ll set your team up.</p></div>;
  return (
    <div className="stack narrow">
      <h1>Start a free pilot</h1>
      <p>Create your team and try PitchReady with up to 5 reps. You get {ctx.pilot?.minutes ?? 60} minutes of practice over {ctx.pilot?.days ?? 14} days, free. No card needed, and it never turns into a paid plan by itself.</p>
      {err && <ErrorBox message={err} />}
      <form className="card" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr(null);
        try { await auth.startPilot(team.trim(), name.trim()); await refresh(); navigate('/manager'); }
        catch (e: any) { setErr(e.message); } finally { setBusy(false); }
      }}>
        <div className="field"><label htmlFor="team">Team or company name</label><input id="team" required minLength={2} maxLength={120} value={team} onChange={(e) => setTeam(e.target.value)} /></div>
        <div className="field"><label htmlFor="yname">Your name</label><input id="yname" required maxLength={80} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          <p className="hint">Shown to the reps you invite.</p></div>
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Setting up…' : 'Create my team'}</button>
      </form>
      <p className="small muted">You’ll start with a fictional example campaign and five practice scenarios, which you can replace with your own under Rules &amp; campaign. By continuing you agree to the <Link to="/terms">Terms and conditions</Link> and <Link to="/dpa">Data processing agreement</Link>.</p>
    </div>
  );
}

export function InvitePage({ token }: { token: string }) {
  const { repo, ctx, refresh } = useApp();
  const [state, setState] = useState<{ loading: boolean; status?: string; email?: string; role?: string; agencyName?: string; error?: string }>({ loading: true });
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (repo.mode === 'demo') { setState({ loading: false, status: 'demo' }); return; }
    auth.checkInvite(token).then((r) => setState({ loading: false, ...r })).catch((e) => setState({ loading: false, error: e.message }));
  }, [repo.mode, token, ctx?.user?.id]);

  if (state.loading) return <Loading label="Checking invitation…" />;
  if (state.status === 'demo') return <div className="stack"><h1>Invitation</h1><div className="alert info">Invitation links are simulated in demo mode. In a connected pilot, this page checks the link on the server, requires sign-in with the invited email, and accepts it once.</div></div>;
  if (state.error) return <ErrorBox message={state.error} />;
  const messages: Record<string, string> = {
    invalid: 'This invitation link is not valid. Check you copied the whole link.',
    expired: 'This invitation has expired. Ask your manager for a new link.',
    revoked: 'This invitation was withdrawn. Ask your manager for a new link.',
    used: 'This invitation has already been used.',
  };
  if (state.status && messages[state.status]) return <div className="stack"><h1>Invitation</h1><ErrorBox message={messages[state.status]!} /></div>;
  const here = `/invite/${encodeURIComponent(token)}`;
  return (
    <div className="stack" style={{ maxWidth: 520 }}>
      <h1>Join {state.agencyName ?? 'your agency'}</h1>
      <p>You’ve been invited as a <strong>{state.role}</strong>.</p>
      {state.status === 'sign_in_required' && (
        <div className="card">
          <p>Sign in or create an account with the email address the invitation was sent to.</p>
          <div className="row">
            <Link to={`/login?next=${encodeURIComponent(here)}`} className="btn primary">Sign in</Link>
            <Link to={`/login?signup=1&next=${encodeURIComponent(here)}`} className="btn">Create account</Link>
          </div>
        </div>
      )}
      {state.status === 'wrong_email' && <ErrorBox message="You’re signed in with a different email address from the one this invitation is for. Sign out and sign in with the invited address." />}
      {state.status === 'email_unconfirmed' && <div className="alert warn">Please confirm your email address first (check your inbox), then reload this page.</div>}
      {state.status === 'ready' && !done && (
        <button className="btn primary big" onClick={async () => {
          try { await auth.acceptInvite(token); setDone(true); await refresh(); } catch (e: any) { setState((s) => ({ ...s, error: e.message })); }
        }}>Accept invitation</button>
      )}
      {done && <div className="alert info">You’ve joined. <Link to={ctx?.user?.role === 'manager' ? '/manager' : '/practice'}>Continue</Link></div>}
    </div>
  );
}

/** Simulated sign-in for the demo: pick a fictional account of the chosen role. No real passwords. */
function DemoSignIn({ role, next }: { role: 'rep' | 'manager'; next: string }) {
  const navigate = useNavigate();
  const { repo, ctx, refresh } = useApp();
  const people = (ctx?.demoPeople ?? []).filter((p) => p.role === role);
  const [chosen, setChosen] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = chosen ?? people.find((p) => p.active)?.id ?? null;
  const person = people.find((p) => p.id === pick);
  return (
    <div className="stack narrow">
      <p className="small"><Link to="/">← Choose a different role</Link></p>
      <h1>Sign in as a {role === 'manager' ? 'manager' : 'sales rep'}</h1>
      <div className="alert info">Simulated sign-in: these are fictional demo accounts and any password works. The pilot uses real accounts with email confirmation.</div>
      {err && <ErrorBox message={err} />}
      <form className="card stack" onSubmit={async (e) => {
        e.preventDefault();
        if (!pick) return;
        setBusy(true); setErr(null);
        try {
          await repo.demoSignIn!(pick);
          await refresh();
          navigate(next || (role === 'manager' ? '/manager' : '/practice'), { replace: true });
        } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
      }}>
        <fieldset className="stack">
          <legend>Account</legend>
          {people.map((p) => (
            <label key={p.id} className={`account-option ${pick === p.id ? 'selected' : ''}`}>
              <input type="radio" name="account" value={p.id} checked={pick === p.id} disabled={!p.active} onChange={() => setChosen(p.id)} />
              <span>{p.name}{p.active ? '' : ' (deactivated by the manager)'}</span>
            </label>
          ))}
        </fieldset>
        <div className="field"><label htmlFor="demo-email">Email</label><input id="demo-email" type="email" value={person?.email ?? ''} readOnly /></div>
        <div className="field"><label htmlFor="demo-password">Password</label><input id="demo-password" type="password" autoComplete="off" placeholder="Any password (demo)" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <button className="btn primary big" type="submit" disabled={!pick || busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
