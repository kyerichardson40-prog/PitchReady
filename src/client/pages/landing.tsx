'use client';
/**
 * Landing page. One orchestrated moment: a front door opens and a short doorstep conversation
 * plays out, ending in the evidence-quoting feedback PitchReady gives. The "street" of three
 * numbered doors explains the steps (a real sequence, so house numbers fit), then a section each
 * for reps and managers. No inline styles (production CSP); all motion is CSS and stops under
 * prefers-reduced-motion.
 */
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app-context.tsx';
import { Link, useNavigate } from '../router.tsx';

function useRevealed<T extends Element>() {
  const ref = useRef<T | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { setShown(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setShown(true); io.disconnect(); }
    }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, shown] as const;
}

function DoorstepScene() {
  return (
    <figure className="lp-scene" aria-labelledby="lp-scene-caption">
      <div className="lp-house" aria-hidden="true">
        <div className="lp-fanlight" />
        <div className="lp-frame">
          <div className="lp-hall" />
          <div className="lp-door">
            <span className="lp-door-number">42</span>
            <span className="lp-panel lp-panel-a" />
            <span className="lp-panel lp-panel-b" />
            <span className="lp-knob" />
          </div>
        </div>
        <div className="lp-step" />
      </div>
      <div className="lp-thread">
        <p className="lp-bubble lp-rep lp-b1"><span className="lp-who">You</span>Hi, I'm Sam from the Neighbourhood Meal Project. Have you got a minute?</p>
        <p className="lp-bubble lp-resident lp-b2"><span className="lp-who">Resident</span>I already give to charity, to be honest.</p>
        <p className="lp-bubble lp-rep lp-b3"><span className="lp-who">You</span>That's great. I'll be quick, and it's completely fine to say no.</p>
        <div className="lp-feedback lp-b4">
          <p className="lp-feedback-title">Your feedback</p>
          <p className="lp-check"><span className="lp-tick">✓</span><span>Said who you are<q>I'm Sam from the Neighbourhood Meal Project</q></span></p>
          <p className="lp-check"><span className="lp-tick">✓</span><span>Made clear it's voluntary<q>completely fine to say no</q></span></p>
          <p className="lp-score"><span>Listening</span><span className="lp-dots" aria-label="4 out of 5"><i /><i /><i /><i /><i className="off" /></span></p>
        </div>
      </div>
      <figcaption id="lp-scene-caption" className="sr-only">
        An example practice: a rep introduces themselves, the resident says they already give to charity, the rep acknowledges it and says it's fine to say no, and the feedback quotes the rep's own words.
      </figcaption>
    </figure>
  );
}

const STEPS = [
  { n: 1, paint: 'teal', title: 'Pick a door', text: "Choose a resident: in a rush, sceptical, already gives to charity. Your manager decides which ones you practise." },
  { n: 2, paint: 'red', title: 'Have the conversation', text: 'Up to three minutes. Speak or type, and the resident answers back. They can say no, just like a real doorstep.' },
  { n: 3, paint: 'cobalt', title: 'See what you said', text: 'Feedback on five areas, each backed by a quote from your conversation, then a one-minute retry of the weakest part.' },
];

export function HomePage() {
  const navigate = useNavigate();
  const { repo, ctx, refresh } = useApp();
  const [streetRef, streetShown] = useRevealed<HTMLOListElement>();
  const demo = repo.mode === 'demo';
  const user = ctx?.user;
  const home = user?.role === 'manager' ? '/manager' : '/practice';

  const primaryCtas = user ? (
    <div className="lp-ctas">
      <button className="lp-btn lp-btn-main" onClick={() => navigate(home)}>Continue as {user.name}</button>
      {demo && <button className="lp-btn lp-btn-quiet" onClick={async () => { await repo.demoSignOut!(); await refresh(); }}>Switch role</button>}
    </div>
  ) : demo ? (
    <div className="lp-ctas">
      <Link to="/login?role=rep" className="lp-btn lp-btn-main">Try it as a rep</Link>
      <Link to="/login?role=manager" className="lp-btn lp-btn-alt">Try it as a manager</Link>
    </div>
  ) : (
    <div className="lp-ctas">
      <Link to="/login" className="lp-btn lp-btn-main">Sign in</Link>
      <a href="#how" className="lp-btn lp-btn-quiet">See how it works</a>
    </div>
  );

  return (
    <div className="lp">
      <section className="lp-hero" aria-labelledby="lp-title">
        <div className="lp-hero-copy">
          <h1 id="lp-title" className="lp-title">Practise the doorstep before you knock.</h1>
          <p className="lp-lede">PitchReady plays the resident. Reps talk it through in three minutes, then get feedback that quotes their exact words: what landed, what to fix, and a quick retry.</p>
          {primaryCtas}
          {demo && !user && <p className="lp-fine">A demo with fictional people and a fictional campaign. Everything stays in this browser.</p>}
        </div>
        <DoorstepScene />
      </section>

      <section id="how" className="lp-street-wrap" aria-labelledby="lp-how">
        <h2 id="lp-how" className="lp-h2">How a practice works</h2>
        <ol ref={streetRef} className={`lp-street${streetShown ? ' is-shown' : ''}`}>
          {STEPS.map((s) => (
            <li key={s.n} className={`lp-house-step lp-paint-${s.paint}`}>
              <div className="lp-mini-door" aria-hidden="true">
                <span className="lp-mini-light" />
                <span className="lp-mini-leaf"><span className="lp-plate">{s.n}</span><span className="lp-mini-knob" /></span>
              </div>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="lp-sides" aria-label="Who it's for">
        <div className="lp-side lp-side-rep">
          <h2 className="lp-h2">For reps</h2>
          <p className="lp-side-lede">Walk into your first shifts having already heard "no thanks" a dozen times.</p>
          <ul className="lp-list">
            <li>Practise on your phone, whenever you've got five minutes.</li>
            <li>See exactly what you said, not just a score.</li>
            <li>Retry the tricky part until it feels natural.</li>
            <li>Keep your must-say lines to hand before every practice.</li>
          </ul>
        </div>
        <div className="lp-side lp-side-manager">
          <h2 className="lp-h2">For managers</h2>
          <p className="lp-side-lede">Grow your team without letting your standards slip.</p>
          <ul className="lp-list">
            <li>Set what reps must say and must never say.</li>
            <li>Write your own residents and choose who practises which.</li>
            <li>See who's practising and where coaching would help most.</li>
            <li>Invite new starters with a link, ready before their first shift.</li>
          </ul>
        </div>
      </section>

      <section className="lp-close" aria-labelledby="lp-close-title">
        <h2 id="lp-close-title" className="lp-close-title">Ready when your team is.</h2>
        {primaryCtas}
        {!demo && !user && <p className="lp-fine">Access is by invitation from your agency.</p>}
      </section>

      <p className="lp-small-print">Working name; this is a pre-pilot prototype. Practice is simulated and does not certify compliance or decide whether anyone can work.</p>
    </div>
  );
}
