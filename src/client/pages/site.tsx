'use client';
/**
 * Public site pages: How it works, About, Contact, Terms, plus the shared footer and call-to-action
 * band. Same visual language as the landing page (painted doors, Bricolage headings).
 * Text inside <Placeholder> is waiting for the owner's real details.
 */
import { useState, type ReactNode } from 'react';
import { useApp } from '../app-context.tsx';
import { Link } from '../router.tsx';
import { CHANNEL_INFO, SALES_CHANNELS } from '../../../lib/domain/sales.ts';
import { DEMO_RUBRIC } from '../../../lib/content/rubric.ts';

const YEAR = new Date().getFullYear();

/** Visible on the page until the owner sends the real wording. */
function Placeholder({ children }: { children: ReactNode }) {
  return <span className="placeholder" title="Placeholder: waiting for your details">{children}</span>;
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div>
          <p className="site-footer-brand">PitchReady</p>
          <p className="small">Practice for every kind of sales conversation.</p>
        </div>
        <nav aria-label="Site" className="site-footer-links">
          <Link to="/how-it-works">How it works</Link>
          <Link to="/about">About us</Link>
          <Link to="/contact">Contact us</Link>
          <Link to="/terms">Terms and conditions</Link>
          <Link to="/login">Sign in</Link>
        </nav>
      </div>
      <p className="site-footer-legal">© {YEAR} PitchReady. Practice is simulated; feedback is coaching, not a certification or an employment decision.</p>
    </footer>
  );
}

export function CtaBand({ title, demo, signedIn, extra }: { title: string; demo?: boolean; signedIn?: boolean; extra?: ReactNode }) {
  return (
    <section className="lp-close" aria-label={title}>
      <h2 className="lp-close-title">{title}</h2>
      {demo || signedIn ? extra : (
        <div className="lp-ctas">
          <Link to="/contact" className="lp-btn lp-btn-main">Contact us</Link>
          <Link to="/login" className="lp-btn lp-btn-quiet">Sign in</Link>
        </div>
      )}
      {!demo && !signedIn && <p className="lp-fine">Already using PitchReady? Sign in with the account your manager invited.</p>}
    </section>
  );
}

function PageHero({ title, lede, paint = 'teal' }: { title: string; lede: string; paint?: 'teal' | 'red' | 'cobalt' | 'mustard' }) {
  return (
    <header className={`site-hero site-hero-${paint}`}>
      <div className="lp-wrap">
        <h1 className="lp-title site-title">{title}</h1>
        <p className="lp-lede">{lede}</p>
      </div>
    </header>
  );
}

function useCtaContext() {
  const { repo, ctx } = useApp();
  return { demo: repo.mode === 'demo', signedIn: !!ctx?.user };
}

function NumberedSteps({ steps, paint }: { steps: { title: string; text: ReactNode }[]; paint: string }) {
  return (
    <ol className={`site-steps site-steps-${paint}`}>
      {steps.map((s, i) => (
        <li key={s.title}>
          <span className="site-plate" aria-hidden="true">{i + 1}</span>
          <div><h3>{s.title}</h3><p>{s.text}</p></div>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ How it works */
export function HowItWorksPage() {
  const cta = useCtaContext();
  return (
    <div className="lp site">
      <PageHero title="How PitchReady works" lede="Managers set up the conversations their team should be able to handle. Reps practise them in three-minute sessions and get feedback that quotes their own words. Here’s the whole process." />

      <section className="site-section" aria-labelledby="h-setup">
        <div className="lp-wrap site-cols">
          <div className="site-col-intro">
            <p className="site-kicker">For managers · about 20 minutes, once</p>
            <h2 id="h-setup" className="lp-h2">1. Set up your team’s practice</h2>
            <p className="lp-section-lede">You stay in control of what “good” sounds like for your business.</p>
          </div>
          <NumberedSteps paint="teal" steps={[
            { title: 'Choose your sales setting', text: 'Door-to-door, phone, shop floor, business meetings, field visits, events or video calls. Tell PitchReady what your team offers and what a good outcome looks like. Ready-made templates get you started in a click.' },
            { title: 'Add your rules', text: 'What reps must say (like who they are, or a cooling-off period), what they must never say, the facts they can use, and your approved answers to common objections.' },
            { title: 'Pick the customers they’ll meet', text: 'Each scenario is a person with an opening line, an objection and a way of behaving: in a rush, sceptical, happy with what they’ve got. Use the starters or write your own, and choose who practises which.' },
            { title: 'Invite your team', text: 'Create a single-use invite link for each rep. They sign up in their browser. No app to install and no AI account needed.' },
          ]} />
        </div>
      </section>

      <section className="site-section site-section-alt" aria-labelledby="h-practise">
        <div className="lp-wrap site-cols">
          <div className="site-col-intro">
            <p className="site-kicker">For reps · three minutes at a time</p>
            <h2 id="h-practise" className="lp-h2">2. Practise the conversation</h2>
            <p className="lp-section-lede">Short enough to fit between shifts, real enough to matter.</p>
          </div>
          <NumberedSteps paint="red" steps={[
            { title: 'Pick a scenario', text: 'Before starting, reps can read the rules and approved answers for their campaign.' },
            { title: 'Talk it through', text: 'Speak or type. The AI customer answers in character and reacts to what the rep actually says: they can ask questions, push back, or end the conversation. Each session lasts up to three minutes and twelve replies.' },
            { title: 'Read the feedback', text: 'A minute or two later: scores for five skills, each with the reason and exact quotes, a tick or cross for each must-say line, flags for never-say phrases or unsupported claims, one strength and one thing to improve.' },
            { title: 'Retry the weak spot', text: 'A one-minute drill puts the rep straight back into the moment that went wrong, so the fix sticks.' },
          ]} />
        </div>
      </section>

      <section className="site-section" aria-labelledby="h-review">
        <div className="lp-wrap site-cols">
          <div className="site-col-intro">
            <p className="site-kicker">For managers · whenever you like</p>
            <h2 id="h-review" className="lp-h2">3. Coach from what really happened</h2>
            <p className="lp-section-lede">No more guessing how a new starter sounds on their own.</p>
          </div>
          <NumberedSteps paint="cobalt" steps={[
            { title: 'See your team at a glance', text: 'Who has practised, how many sessions, average scores by skill, and anything flagged for review.' },
            { title: 'Open any practice', text: 'Read the full transcript next to the feedback. If speech-to-text misheard something, correct it and the feedback is redone.' },
            { title: 'Coach the next shift', text: 'Add review notes, adjust which scenarios a rep practises, or update your rules. Changes apply to new practice straight away.' },
          ]} />
        </div>
      </section>

      <section className="site-section site-section-alt" aria-labelledby="h-skills">
        <div className="lp-wrap">
          <h2 id="h-skills" className="lp-h2">The five skills we score</h2>
          <p className="lp-section-lede">Each is scored 1 to 5 against clear descriptions you can edit to match your own training.</p>
          <ul className="site-skill-grid">
            {DEMO_RUBRIC.dimensions.map((d, i) => (
              <li key={d.key} className={`site-skill site-skill-${i % 4}`}>
                <h3>{d.label}</h3>
                <p>{d.anchors.find((a) => a.score === 5)!.description}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="site-section" aria-labelledby="h-ai">
        <div className="lp-wrap">
          <h2 id="h-ai" className="lp-h2">What the AI does, and what it doesn’t</h2>
          <div className="site-split">
            <div className="site-does">
              <h3>It does</h3>
              <ul className="lp-list">
                <li>Play a realistic customer for your setting, following the scenario you chose.</li>
                <li>Stick to your approved facts and say no when the scenario calls for it.</li>
                <li>Quote the rep’s exact words for every point of feedback.</li>
                <li>Flag possible problems for a person to review.</li>
              </ul>
            </div>
            <div className="site-doesnt">
              <h3>It doesn’t</h3>
              <ul className="lp-list">
                <li>Judge personality, accent, or anything about who the rep is.</li>
                <li>Reward pressure, or require a sale to score well.</li>
                <li>Decide who passes, who’s hired or who can work.</li>
                <li>Keep recordings of anyone’s voice.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="site-section site-section-alt" aria-labelledby="h-settings">
        <div className="lp-wrap">
          <h2 id="h-settings" className="lp-h2">Settings it’s built for</h2>
          <ul className="site-setting-list">
            {SALES_CHANNELS.filter((c) => c !== 'other').map((c) => (
              <li key={c}><strong>{CHANNEL_INFO[c].label}</strong><span>{CHANNEL_INFO[c].scene}</span></li>
            ))}
          </ul>
        </div>
      </section>

      <CtaBand title="Want to see it with your own team?" demo={cta.demo} signedIn={cta.signedIn} extra={<div className="lp-ctas"><Link to="/" className="lp-btn lp-btn-main">Back to the homepage</Link></div>} />
      <SiteFooter />
    </div>
  );
}

/* ------------------------------------------------------------------ About */
export function AboutPage() {
  const cta = useCtaContext();
  return (
    <div className="lp site">
      <PageHero paint="mustard" title="About PitchReady" lede="Built by a door-to-door salesperson and trainer, for every kind of sales team." />
      <section className="site-section" aria-labelledby="a-story">
        <div className="lp-wrap site-about">
          <div className="site-portrait"><img src="/images/kye-richardson.jpg" alt="Kye Richardson, founder of PitchReady" width={440} height={560} /></div>
          <div className="site-prose">
            <h2 id="a-story" className="lp-h2">The story</h2>
            <p>I’m Kye Richardson. I’ve spent around two and a half years in door-to-door sales and paid fundraising. In that time I trained more than 100 new starters and reached the top of the national sales rankings on several occasions.</p>
            <p>I built PitchReady because I saw how hard it can be for new reps to build confidence and improve their pitch, and how little managers could see of what their reps were actually saying, or where they needed support.</p>
            <p>PitchReady gives reps a place to practise, handle objections and develop their delivery before they speak to customers, and gives managers a clear picture of where to help.</p>
            <p className="site-signoff"><strong>Kye Richardson</strong><span>Founder · Kent, UK</span></p>
            <ul className="site-facts">
              <li><strong>2½ years</strong><span>in door-to-door sales and paid fundraising</span></li>
              <li><strong>100+</strong><span>new starters trained</span></li>
              <li><strong>Top national rankings</strong><span>for sales, on several occasions</span></li>
            </ul>
          </div>
        </div>
      </section>
      <section className="site-section site-section-alt" aria-labelledby="a-believe">
        <div className="lp-wrap">
          <h2 id="a-believe" className="lp-h2">What we believe</h2>
          <div className="lp-trust-grid">
            <div><h3>Practice should be safe</h3><p>The first time someone hears a tough objection shouldn’t be in front of a real customer.</p></div>
            <div><h3>Feedback should be specific</h3><p>“Good job” helps no one. Quoting what someone said, and what to try instead, does.</p></div>
            <div><h3>Respect sells</h3><p>A polite, honest conversation that ends in “no” is better than a pushy one that ends in a complaint.</p></div>
            <div><h3>Managers know best</h3><p>Every team sells differently. PitchReady follows your rules and your words, not a generic script.</p></div>
          </div>
        </div>
      </section>
      <CtaBand title="Want to talk about your team?" demo={cta.demo} signedIn={cta.signedIn} extra={<div className="lp-ctas"><Link to="/contact" className="lp-btn lp-btn-main">Contact us</Link></div>} />
      <SiteFooter />
    </div>
  );
}

/* ------------------------------------------------------------------ Contact */
const TEAM_SIZES = ['Just me', '2–5 reps', '6–20 reps', '21–50 reps', 'More than 50 reps'];

export function ContactPage() {
  const { repo } = useApp();
  const [f, setF] = useState({ name: '', email: '', company: '', team_size: '', sales_type: '', message: '', website: '' });
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="lp site">
      <PageHero paint="cobalt" title="Contact us" lede="Questions, a pilot for your team, or just curious? Send a message and we’ll get back to you." />
      <section className="site-section" aria-label="Contact form">
        <div className="lp-wrap site-contact">
          {state === 'sent' ? (
            <div className="card feedback-hero" role="status">
              <h2>Message sent</h2>
              <p>Thanks, {f.name.split(' ')[0] || 'there'}. We’ll reply to {f.email} as soon as we can.</p>
              <Link to="/" className="btn">Back to the homepage</Link>
            </div>
          ) : (
            <form className="card stack" noValidate onSubmit={async (e) => {
              e.preventDefault(); setErr(null);
              if (!f.name.trim() || !/^\S+@\S+\.\S+$/.test(f.email.trim()) || f.message.trim().length < 10) { setErr('Please add your name, a valid email address and a message of at least 10 characters.'); return; }
              setState('sending');
              try { await repo.sendContact(f); setState('sent'); } catch (x: any) { setErr(x.message ?? 'Something went wrong. Please try again.'); setState('idle'); }
            }}>
              {err && <div className="alert error" role="alert">{err}</div>}
              <div className="grid two">
                <div className="field"><label htmlFor="ct-name">Your name</label><input id="ct-name" autoComplete="name" value={f.name} onChange={set('name')} required maxLength={120} /></div>
                <div className="field"><label htmlFor="ct-email">Email</label><input id="ct-email" type="email" autoComplete="email" value={f.email} onChange={set('email')} required maxLength={254} /></div>
              </div>
              <div className="field"><label htmlFor="ct-company">Company <span className="muted small">(optional)</span></label><input id="ct-company" autoComplete="organization" value={f.company} onChange={set('company')} maxLength={160} /></div>
              <div className="grid two">
                <div className="field"><label htmlFor="ct-size">Team size <span className="muted small">(optional)</span></label>
                  <select id="ct-size" value={f.team_size} onChange={set('team_size')}><option value="">Choose…</option>{TEAM_SIZES.map((t) => <option key={t}>{t}</option>)}</select></div>
                <div className="field"><label htmlFor="ct-type">Kind of sales <span className="muted small">(optional)</span></label>
                  <select id="ct-type" value={f.sales_type} onChange={set('sales_type')}><option value="">Choose…</option>{SALES_CHANNELS.map((c) => <option key={c}>{CHANNEL_INFO[c].label}</option>)}</select></div>
              </div>
              <div className="field"><label htmlFor="ct-msg">Message</label><textarea id="ct-msg" rows={6} value={f.message} onChange={set('message')} required maxLength={4000} /></div>
              <div className="hp-field" aria-hidden="true"><label htmlFor="ct-web">Leave this empty</label><input id="ct-web" tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></div>
              <p className="small muted m0">We only use your details to reply to you. See our <Link to="/terms">terms</Link>.</p>
              <div className="row"><button className="btn primary big" type="submit" disabled={state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Send message'}</button></div>
            </form>
          )}
          <aside className="site-contact-side">
            <h2 className="lp-h2">What happens next</h2>
            <NumberedSteps paint="cobalt" steps={[
              { title: 'We read every message', text: 'Usually within one working day.' },
              { title: 'A short call', text: 'We’ll ask how your team sells today and what you’d like new starters to get better at.' },
              { title: 'A pilot, if it fits', text: 'Set up with your rules and scenarios, so you can judge it on your own team.' },
            ]} />
          </aside>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}

/* ------------------------------------------------------------------ Terms */
export function TermsPage() {
  return (
    <div className="lp site">
      <PageHero paint="red" title="Terms and conditions" lede="The agreement between us and the businesses that use PitchReady, in plain English." />
      <section className="site-section" aria-label="Terms">
        <div className="lp-wrap site-prose site-terms">
          <p className="alert warn">Draft for review. These terms have not yet been checked by a solicitor.</p>
          <p className="small muted">Last updated: <Placeholder>[date]</Placeholder></p>

          <h2>1. Who we are</h2>
          <p>PitchReady is provided by <Placeholder>[your name or business name, trading as PitchReady]</Placeholder>{' '}(“we”, “us”). <Placeholder>[If a company: registered in England and Wales, company number …, registered office …]</Placeholder> You can contact us using our <Link to="/contact">contact page</Link>.</p>

          <h2>2. Who these terms are for</h2>
          <p>PitchReady is a service for businesses and organisations (“customers”) that train people to sell. These terms apply to the customer that signs up, and to everyone the customer invites (managers and reps, together “users”). The customer is responsible for its users following these terms. PitchReady is not offered to consumers for personal use.</p>

          <h2>3. What PitchReady does</h2>
          <p>PitchReady lets users practise sales conversations with a simulated, AI-generated customer and receive automated coaching feedback. Practice is simulated. Feedback is generated automatically, can be wrong, and is coaching only. It is not legal, regulatory or compliance advice, not a certification, and must not be the sole basis for decisions about anyone’s employment.</p>

          <h2>4. Accounts</h2>
          <ul>
            <li>Accounts are by invitation from a customer’s manager.</li>
            <li>Keep your sign-in details secure and don’t share accounts. Tell us straight away if you think an account has been misused.</li>
            <li>Managers can see their own team’s practice transcripts and feedback, invite and remove users, and set rules and scenarios.</li>
          </ul>

          <h2>5. Pilots, plans and payment</h2>
          <p>Pilots and paid plans, including their length, included practice time and price, are as agreed with you in writing (for example by email or an order form). Unless agreed otherwise, fees are payable in advance and are non-refundable except where the law requires. Practice time that isn’t used doesn’t carry over. We may pause practice if a plan’s included time or a fair-use limit is reached.</p>

          <h2>6. Acceptable use</h2>
          <p>You must not use PitchReady to:</p>
          <ul>
            <li>break the law, or the rules or codes of practice that apply to your sector;</li>
            <li>upload real customers’ personal information into campaigns, scenarios or practice conversations;</li>
            <li>upload content that is offensive, discriminatory or infringes anyone’s rights;</li>
            <li>try to break, overload or get around the service’s security or limits, or misuse the AI (for example by trying to make it ignore its instructions);</li>
            <li>copy, resell or reverse-engineer the service.</li>
          </ul>

          <h2>7. Your content</h2>
          <p>You keep ownership of the material you add, such as campaign information, rules, scenarios and practice conversations. You give us permission to store and process it only to provide, secure and improve the service for you. You are responsible for making sure your campaign information is accurate and that you are allowed to use it.</p>

          <h2>8. Personal data</h2>
          <p>For users’ practice data, the customer decides how it is used and we process it on the customer’s behalf, under a data processing agreement available on request. Recordings are converted to text and not kept by us; transcripts and feedback are deleted after the customer’s retention period (30 days by default). We use trusted providers to run the service, including for hosting, the database, speech-to-text and AI. More detail is in our privacy notice <Placeholder>[link once published]</Placeholder>.</p>

          <h2>9. Availability and changes</h2>
          <p>We aim to keep PitchReady available and working well, but we don’t promise it will always be uninterrupted or error-free. We may change or improve features. If a change significantly reduces what you’ve paid for, we’ll tell you in advance and you may end your plan.</p>

          <h2>10. Our liability</h2>
          <p>Nothing in these terms limits liability for death or personal injury caused by negligence, for fraud, or for anything else that cannot be limited by law. Otherwise, we are not liable for indirect or consequential loss, or for loss of profits, sales, business or goodwill, and our total liability in any 12 months is limited to the fees you paid us in that period.</p>

          <h2>11. Ending the agreement</h2>
          <p>You can stop using PitchReady at any time. We may suspend or end access if these terms are seriously broken, if fees go unpaid after a reminder, or if we stop providing the service (in which case we’ll give reasonable notice). When an account ends, its practice data is deleted in line with the retention period.</p>

          <h2>12. Changes to these terms</h2>
          <p>We may update these terms. We’ll show the date of the latest version on this page and tell customers about important changes before they take effect.</p>

          <h2>13. Law</h2>
          <p>These terms are governed by the law of England and Wales, and the courts of England and Wales have jurisdiction.</p>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
