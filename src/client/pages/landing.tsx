'use client';
/**
 * Landing page. One orchestrated moment: a door opens and a short practice conversation plays out,
 * ending in the evidence-quoting feedback PitchReady gives. Each loop shows a different sales
 * setting (doorstep, phone, meeting). No inline styles (production CSP); all motion is CSS and
 * stops under prefers-reduced-motion (the first conversation is then shown still).
 */
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app-context.tsx';
import { Link, useNavigate } from '../router.tsx';
import { CtaBand, SiteFooter } from './site.tsx';

function useRevealed<T extends Element>() {
  const ref = useRef<T | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { setShown(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setShown(true); io.disconnect(); }
    }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, shown] as const;
}

const SCRIPTS = [
  {
    setting: 'On the doorstep', who: 'Resident', number: '42',
    rep1: "Hi, I'm Sam from the Neighbourhood Meal Project. Have you got a minute?",
    them: 'I already give to charity, to be honest.',
    rep2: "That's great. I'll be quick, and it's completely fine to say no.",
    checks: [['Said who you are', "I'm Sam from the Neighbourhood Meal Project"], ["Made clear it's voluntary", 'completely fine to say no']],
    skill: 'Listening', score: 4,
  },
  {
    setting: 'On the phone', who: 'Customer', number: '07',
    rep1: "Hi, it's Sam from BrightLine about your account. Is now an okay time?",
    them: "I'm happy with what I've got, thanks.",
    rep2: "That's fair. Can I ask how you mostly use your internet at home?",
    checks: [["Checked it's a good time", 'Is now an okay time?'], ['Asked before pitching', 'how you mostly use your internet']],
    skill: 'Listening', score: 4,
  },
  {
    setting: 'In a meeting', who: 'Prospect', number: '3B',
    rep1: 'Thanks for making the time. Shall I start by asking how you do your books today?',
    them: 'My accountant sorts all that out.',
    rep2: 'That makes sense. What takes up most of your time before you send things over?',
    checks: [['Asked how they work now', 'how you do your books today'], ['Acknowledged their set-up', 'That makes sense.']],
    skill: 'Listening', score: 5,
  },
] as const;

const LOOP_MS = 16_000;

function PracticeScene() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setI((n) => (n + 1) % SCRIPTS.length), LOOP_MS);
    return () => clearInterval(t);
  }, []);
  const s = SCRIPTS[i]!;
  return (
    <figure className="lp-scene" aria-labelledby="lp-scene-caption" key={i}>
      <div className="lp-house" aria-hidden="true">
        <div className="lp-fanlight" />
        <div className="lp-frame">
          <div className="lp-hall" />
          <div className="lp-door">
            <span className="lp-door-number">{s.number}</span>
            <span className="lp-panel lp-panel-a" />
            <span className="lp-panel lp-panel-b" />
            <span className="lp-knob" />
          </div>
        </div>
        <div className="lp-step" />
      </div>
      <div className="lp-thread">
        <p className="lp-setting">{s.setting}</p>
        <p className="lp-bubble lp-rep lp-b1"><span className="lp-who">You</span>{s.rep1}</p>
        <p className="lp-bubble lp-resident lp-b2"><span className="lp-who">{s.who}</span>{s.them}</p>
        <p className="lp-bubble lp-rep lp-b3"><span className="lp-who">You</span>{s.rep2}</p>
        <div className="lp-feedback lp-b4">
          <p className="lp-feedback-title">Your feedback</p>
          {s.checks.map(([label, quote]) => (
            <p className="lp-check" key={label}><span className="lp-tick">✓</span><span>{label}<q>{quote}</q></span></p>
          ))}
          <p className="lp-score"><span>{s.skill}</span><span className="lp-dots" aria-label={`${s.score} out of 5`}>{[1, 2, 3, 4, 5].map((n) => <i key={n} className={n > s.score ? 'off' : undefined} />)}</span></p>
        </div>
      </div>
      <figcaption id="lp-scene-caption" className="sr-only">
        Example practice {s.setting.toLowerCase()}: the rep opens, the {s.who.toLowerCase()} raises an objection, the rep acknowledges it, and the feedback quotes the rep's own words.
      </figcaption>
    </figure>
  );
}

const STEPS = [
  { n: 1, paint: 'teal', title: 'Pick a scenario', text: 'Choose who you want to practise with: in a rush, sceptical, happy with what they have. Your manager decides which ones you get.' },
  { n: 2, paint: 'red', title: 'Have the conversation', text: 'Up to three minutes. Speak or type, and the AI customer answers back. They can say no, just like a real one.' },
  { n: 3, paint: 'cobalt', title: 'See what you said', text: 'Feedback on five skills, each backed by a quote from your conversation, then a one-minute retry of the weakest moment.' },
];

const CHANNELS = [
  { name: 'Door-to-door', eg: 'Charities, energy, home services', paint: 'teal' },
  { name: 'Phone and telesales', eg: 'Upgrades, renewals, appointment setting', paint: 'red' },
  { name: 'Shop floor', eg: 'Add-ons, care plans, finance options', paint: 'cobalt' },
  { name: 'Business meetings', eg: 'Software, services, partnerships', paint: 'mustard' },
  { name: 'Field visits', eg: 'Solar, home improvement, surveys', paint: 'teal' },
  { name: 'Events and street', eg: 'Gyms, memberships, sign-ups', paint: 'red' },
  { name: 'Video calls', eg: 'Demos, consultations, follow-ups', paint: 'cobalt' },
];

const FAQS = [
  { q: 'What kinds of sales does it work for?', a: 'Any conversation where a rep talks someone through an offer: on doorsteps, on the phone, in store, in meetings, on visits, at events or on video calls. You choose the setting, and the AI customer behaves to match: on the phone they can hang up, in a meeting they think about cost and who else must agree.' },
  { q: 'Do reps need an AI account or an app?', a: 'No. Reps open PitchReady in the browser on their phone or computer and sign in with the invite you send. The AI is included.' },
  { q: 'Can we use our own scripts and rules?', a: 'Yes. You set what reps must say and must never say, the facts they can use, your approved answers to common objections, and the customers they practise with. Start from a ready-made template for your kind of sales, or from scratch.' },
  { q: 'Is the feedback just a score?', a: 'No. Every point quotes the rep’s exact words, so they can see what landed and what to change. Scores are coaching, not a pass or fail, and a respectful “no” can score well.' },
  { q: 'What happens to recordings?', a: 'When a rep speaks, the audio is turned into text and PitchReady doesn’t keep the recording. Transcripts and feedback are deleted after 30 days by default. Managers can read their own team’s practice; other teams can’t.' },
  { q: 'How much does it cost?', a: 'We run pilots with small teams first so you can see the difference before committing. Get in touch and we’ll talk through what would suit your team.' },
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
      <Link to="/how-it-works" className="lp-btn lp-btn-quiet">See how it works</Link>
    </div>
  );

  return (
    <div className="lp">
      <section className="lp-hero" aria-labelledby="lp-title">
        <div className="lp-hero-copy">
          <h1 id="lp-title" className="lp-title">Practise the pitch before the real one.</h1>
          <p className="lp-lede">PitchReady plays your customer: on the doorstep, on the phone, on the shop floor or across a meeting table. Your team practises in three minutes and gets feedback that quotes their exact words.</p>
          {primaryCtas}
          {demo && !user && <p className="lp-fine">A demo with fictional people and a fictional campaign. Everything stays in this browser.</p>}
        </div>
        <PracticeScene />
      </section>

      <section className="lp-channels" aria-labelledby="lp-channels-title">
        <div className="lp-wrap">
          <h2 id="lp-channels-title" className="lp-h2">Built for every kind of sales conversation</h2>
          <p className="lp-section-lede">Pick where your team sells. The AI customer behaves like a real one in that setting, and feedback judges what good looks like there.</p>
          <ul className="lp-channel-grid">
            {CHANNELS.map((c) => (
              <li key={c.name} className={`lp-channel lp-paint-${c.paint}`}>
                <strong>{c.name}</strong>
                <span>{c.eg}</span>
              </li>
            ))}
          </ul>
        </div>
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
        <div className="lp-street-more"><Link to="/how-it-works" className="lp-btn lp-btn-alt">See the full process</Link></div>
      </section>

      <section className="lp-feedback-band" aria-labelledby="lp-fb-title">
        <div className="lp-wrap lp-two">
          <div>
            <h2 id="lp-fb-title" className="lp-h2">Feedback that quotes you</h2>
            <p className="lp-section-lede">Reps don’t get a vague score. They see exactly which of their words worked, which rules they covered, and one thing to try next.</p>
            <ul className="lp-points">
              <li><strong>Five skills, scored 1 to 5.</strong> Introduction, accuracy, listening, next step and respect, each with the reason.</li>
              <li><strong>Every point backed by a quote.</strong> Feedback can only cite words the rep actually said.</li>
              <li><strong>Your rules, checked.</strong> A tick for each must-say line, a flag for any never-say phrase.</li>
              <li><strong>A one-minute retry.</strong> Practise the weakest moment again while it’s fresh.</li>
            </ul>
          </div>
          <div className="lp-sample" aria-label="Example feedback">
            <p className="lp-feedback-title">Your feedback · Phone practice</p>
            <div className="lp-sample-row"><span>Introduction</span><span className="lp-dots" aria-label="4 out of 5"><i /><i /><i /><i /><i className="off" /></span></div>
            <div className="lp-sample-row"><span>Accuracy</span><span className="lp-dots" aria-label="5 out of 5"><i /><i /><i /><i /><i /></span></div>
            <div className="lp-sample-row"><span>Listening</span><span className="lp-dots" aria-label="3 out of 5"><i /><i /><i /><i className="off" /><i className="off" /></span></div>
            <p className="lp-sample-label">What worked</p>
            <p className="lp-sample-quote">You stated the price and contract clearly: <q>£32 a month on an 18-month contract</q></p>
            <p className="lp-sample-label">Try next</p>
            <p className="lp-sample-quote">When they said <q>I’m happy with what I’ve got</q>, ask one question before explaining the offer.</p>
            <p className="lp-check"><span className="lp-tick">✓</span><span>Mentioned the 14-day cooling-off period</span></p>
            <p className="lp-check"><span className="lp-tick lp-tick-no">✗</span><span>Didn’t check it was a good time to talk</span></p>
          </div>
        </div>
      </section>

      <section className="lp-sides" aria-label="Who it's for">
        <div className="lp-side lp-side-rep">
          <h2 className="lp-h2">For reps</h2>
          <p className="lp-side-lede">Walk into your first real conversations having already heard “no thanks” a dozen times.</p>
          <ul className="lp-list">
            <li>Practise on your phone, whenever you’ve got five minutes.</li>
            <li>See exactly what you said, not just a score.</li>
            <li>Retry the tricky part until it feels natural.</li>
            <li>Keep your must-say lines and approved answers to hand.</li>
          </ul>
        </div>
        <div className="lp-side lp-side-manager">
          <h2 className="lp-h2">For managers</h2>
          <p className="lp-side-lede">Grow your team without letting your standards slip.</p>
          <ul className="lp-list">
            <li>Set what reps must say and must never say, and the facts they can use.</li>
            <li>Choose the customers each rep practises with, or write your own.</li>
            <li>See who’s practising and where coaching would help most.</li>
            <li>Invite new starters with a link, ready before their first shift.</li>
          </ul>
        </div>
      </section>

      <section className="lp-trust" aria-labelledby="lp-trust-title">
        <div className="lp-wrap">
          <h2 id="lp-trust-title" className="lp-h2">Practice, not surveillance</h2>
          <div className="lp-trust-grid">
            <div><h3>A “no” can be a win</h3><p>Feedback never rewards pressure. Handling a refusal politely scores well, and making the sale isn’t required.</p></div>
            <div><h3>Honest over clever</h3><p>Saying “I’ll check” beats making something up. Feedback flags claims your approved facts don’t support.</p></div>
            <div><h3>Short-lived data</h3><p>Recordings aren’t kept. Transcripts and feedback are deleted after 30 days by default.</p></div>
            <div><h3>Coaching, not judging</h3><p>Scores support conversations between managers and reps. They aren’t a test, and they don’t decide who can work.</p></div>
          </div>
        </div>
      </section>

      <section className="lp-faq" aria-labelledby="lp-faq-title">
        <div className="lp-wrap lp-narrow">
          <h2 id="lp-faq-title" className="lp-h2">Questions</h2>
          {FAQS.map((f) => (
            <details key={f.q} className="lp-faq-item">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <CtaBand title="Ready to give your team more practice?" demo={demo} signedIn={!!user} extra={primaryCtas} />
      <SiteFooter />
    </div>
  );
}
