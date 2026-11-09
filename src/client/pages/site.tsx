'use client';
/**
 * Public site pages: How it works, About, Contact, Terms, plus the shared footer and call-to-action
 * band. Same visual language as the landing page (painted doors, Bricolage headings).
 */
import { useState, type ReactNode } from 'react';
import { useApp } from '../app-context.tsx';
import { Link } from '../router.tsx';
import { CHANNEL_INFO, SALES_CHANNELS } from '../../../lib/domain/sales.ts';
import { DEMO_RUBRIC } from '../../../lib/content/rubric.ts';
import { TERMS_EFFECTIVE_DATE } from '../../../lib/content/legal.ts';

const YEAR = new Date().getFullYear();

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
          <Link to="/privacy">Privacy</Link>
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
              <p className="small muted m0">We only use your details to reply to you. See our <Link to="/privacy">privacy notice</Link>.</p>
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
const TERMS_EMAIL = 'kye.pitchready@gmail.com';

/** Something still to fill in before these terms are final: shown highlighted so it can't be missed. */
function Todo({ children }: { children: ReactNode }) {
  return <mark className="todo">[{children}]</mark>;
}

export function TermsPage() {
  const email = <a href={`mailto:${TERMS_EMAIL}`}>{TERMS_EMAIL}</a>;
  return (
    <div className="lp site">
      <PageHero paint="red" title="Terms and conditions" lede="The agreement between PitchReady and the businesses that use it." />
      <section className="site-section" aria-label="Terms">
        <div className="lp-wrap site-prose site-terms">
          <p className="alert warn">Draft for completion and legal review. These terms have not yet been checked by a solicitor. Highlighted items are still to be completed.</p>
          <p className="small muted">Effective date: {TERMS_EFFECTIVE_DATE}</p>

          <h2>1. Who we are</h2>
          <p>PitchReady is provided by Kye Richardson trading as PitchReady (“PitchReady”, “we”, “us” or “our”), a sole trader based in Kent, United Kingdom.</p>
          <p>Business correspondence and service address: <Todo>full business or service address</Todo>.</p>
          <p>Email for support, complaints and legal notices: {email}.</p>
          <p>These terms apply to the business or organisation purchasing or agreeing to use PitchReady (the “customer”, “you” or “your”). An individual accepting an order on behalf of a customer must have authority to bind that customer.</p>

          <h2>2. Business use and agreement</h2>
          <p>PitchReady is supplied for business and organisational use, not for consumers acting mainly outside their trade, business, craft or profession.</p>
          <p>Your agreement comprises these terms, the order agreed with you in writing, and our Data Processing Agreement (“DPA”) where we process personal data on your behalf. An order may be an order form or an email exchange that expressly confirms the purchase or pilot and refers to these terms.</p>
          <p>The agreement starts when you accept an order referencing these terms or complete an account-registration process that expressly requires acceptance of them. Merely browsing our website does not create a paid subscription.</p>
          <p>If documents conflict, the DPA takes priority for personal-data processing; the order takes priority for the purchased service, fees and duration; and these terms otherwise apply. An order changes a legal provision of these terms only if it expressly identifies that provision and the agreed change. Your purchase-order terms do not apply unless we expressly agree to them in writing.</p>

          <h2>3. What PitchReady provides</h2>
          <p>PitchReady enables users to practise sales conversations with an AI-generated simulated customer and receive automated coaching feedback. Available features and usage allowances are described in your order.</p>
          <p>Practice conversations are simulations. AI-generated responses, transcripts, scores and feedback may be inaccurate, incomplete, inconsistent or unsuitable for a particular situation. They are training aids, not legal, regulatory or compliance advice, professional certification, or a guarantee of sales results.</p>
          <p>You are responsible for checking that campaign material, scripts and training practices comply with applicable laws and sector rules. Managers must review feedback in context and allow users to raise errors. You must not use automated scores or feedback as the sole basis for recruitment, dismissal, disciplinary action, pay, promotion or other decisions that significantly affect a person.</p>
          <p>We will provide the service with reasonable care and skill. No particular sales outcome, performance improvement or uninterrupted availability is promised.</p>

          <h2>4. Accounts and users</h2>
          <p>You may invite authorised managers and reps (“users”) within the seats and permissions in your plan. You are responsible for administering your organisation’s accounts, ensuring users are authorised and informing them of the applicable use rules.</p>
          <p>Users must keep credentials secure, use individual accounts and promptly report suspected unauthorised access. You must remove access when it is no longer needed. We remain responsible for security within our control.</p>
          <p>Authorised managers can access their team’s practice transcripts, scores and feedback, manage users, and configure training content within the available permissions. You must explain this access and your use of the information to users before they begin.</p>

          <h2>5. Pilots, plans and usage</h2>
          <p>Before you agree, your order will state:</p>
          <ul>
            <li>whether access is a free pilot, paid pilot or subscription;</li>
            <li>the start date, initial term and any renewal period;</li>
            <li>included seats, features and practice allowance;</li>
            <li>how usage is measured, when allowances reset, and any fair-use limits;</li>
            <li>fees, payment dates and whether applicable VAT is included or added;</li>
            <li>any agreed support arrangements or service levels.</li>
          </ul>
          <p>A free pilot ends on its stated end date and will not convert to a paid plan without your express agreement. A fixed-duration paid pilot also ends on its stated end date unless a further plan is agreed.</p>
          <p>Unless your order says otherwise, subscriptions run monthly and renew for successive monthly periods. Fees are payable in advance. Unused allowances expire at the end of the relevant allowance period and do not carry over.</p>
          <p>We may pause additional practice when the agreed allowance or a disclosed fair-use limit is reached. We will not charge for extra usage or upgrade your plan without your express agreement. Any customer-specific limit must be disclosed before you agree to it.</p>

          <h2>6. Payment, price changes and cancellation</h2>
          <p>You must pay undisputed invoices by their stated due date. Tell us promptly if you dispute an invoice and explain why; we will investigate in good faith. Pay any undisputed balance when due.</p>
          <p>You may cancel renewal by emailing the address in section 1 at any time before the next renewal date. Unless your order says otherwise, cancellation takes effect at the end of the current paid period, access continues until then, and no further renewal fee is due. Stopping use or removing users does not itself cancel a subscription.</p>
          <p>We may change subscription prices at renewal by giving at least 30 days’ written notice. If you do not accept the new price, you may cancel before it takes effect. Agreed fees will not change during a fixed paid term without your agreement.</p>
          <p>Except as set out below, cancelling for convenience does not entitle you to a refund for the current paid period or unused practice time.</p>
          <p>We will refund the proportion of prepaid fees relating to the unused period after termination if you terminate because of our material breach that remains unremedied under section 13, or because of a material reduction under section 11, or if we end the service or your agreement for convenience. We will make those refunds within 14 days after termination. This does not remove any other remedy available under the agreement or applicable law, subject to section 15.</p>

          <h2>7. Acceptable use</h2>
          <p>You must ensure users do not:</p>
          <ul>
            <li>use PitchReady unlawfully, fraudulently, or contrary to applicable sector requirements;</li>
            <li>enter real customers’ personal information, payment-card details, passwords or other secrets into training material or conversations;</li>
            <li>enter sensitive personal information, including health information, unless we have expressly agreed appropriate arrangements in writing;</li>
            <li>upload unlawful, discriminatory, harassing or rights-infringing content;</li>
            <li>access another organisation’s data or accounts, interfere with security, overload the service or evade usage limits;</li>
            <li>attempt to manipulate the AI to obtain prohibited content or compromise the service;</li>
            <li>resell access, share accounts outside your authorised users, or copy or reverse-engineer the service except where applicable law permits this despite a contractual restriction.</li>
          </ul>
          <p>Realistic objection handling and challenging simulated conversations are permitted where used lawfully for training.</p>

          <h2>8. Intellectual property and customer content</h2>
          <p>We and our licensors retain rights in PitchReady’s software, design and underlying materials. During your agreement, we grant you a non-exclusive, non-transferable right to use the service for your internal business training, within your plan limits.</p>
          <p>As between you and us, you retain your rights in the material you and your users submit, including scripts, scenarios and campaign information. To the extent you hold rights in practice transcripts and feedback, we do not claim ownership of those rights. This does not guarantee that AI-generated material attracts intellectual-property protection or is unique.</p>
          <p>You grant us the limited permission needed to host, transmit and process customer content to supply, support and secure the service, subject to the DPA where personal data is involved. You must have the necessary rights to provide that content.</p>
          <p>We will not use identifiable practice content to train general-purpose AI models. Any use of personal data for analysis or service improvement must be expressly covered by the DPA and your documented instructions. We may use statistics that have been irreversibly anonymised so they do not identify an individual or disclose your confidential information.</p>

          <h2>9. Confidentiality</h2>
          <p>Each party must protect the other’s confidential information with reasonable care, use it only to perform or exercise rights under the agreement, and disclose it only to people or providers who need it for that purpose and are subject to suitable confidentiality obligations.</p>
          <p>Confidential information includes non-public campaign material, scripts, pricing, business information and practice content. It excludes information the recipient can demonstrate was already lawfully known, independently developed, lawfully obtained from another source without restriction, or public without a breach of this agreement.</p>
          <p>Disclosure required by law is permitted. Where lawful, the disclosing party must give advance notice and limit disclosure to what is required. Confidentiality continues after the agreement ends for as long as the information remains confidential.</p>

          <h2>10. Personal data</h2>
          <p>For personal data in practice content processed on your behalf, you are the controller and we are the processor. Our DPA <Todo>link to completed DPA</Todo> forms part of this agreement. We will not activate processing of that data until the DPA is incorporated into the agreement.</p>
          <p>You are responsible for establishing a lawful basis for your use of users’ data, providing appropriate privacy information, agreeing manager access and the retention period with us, and meeting applicable employment and data-protection obligations. This does not reduce our own obligations under data-protection law.</p>
          <p>The DPA will specify processing instructions, data categories, security measures, confidentiality, assistance with individual rights and security incidents, approved subprocessors, international-transfer safeguards, audit arrangements and deletion or return of data. Changes to our providers will follow the notice and objection process in the DPA. Our current providers are:</p>
          <ul>
            <li><strong>Railway</strong>: hosting the website and app (<Todo>hosting region</Todo>).</li>
            <li><strong>Supabase</strong>: database and sign-in, stored in the EU (Ireland).</li>
            <li><strong>Anthropic</strong>: the AI that plays the customer and writes feedback (United States).</li>
            <li><strong>Deepgram</strong>: speech-to-text and reading the customer’s lines aloud (United States).</li>
          </ul>
          <p><strong>Audio:</strong> when a user speaks during practice, the recording is sent to Deepgram to be turned into text and is not stored by PitchReady. Every request to Deepgram opts out of its model improvement programme, so Deepgram keeps the audio only as long as needed to process the request and does not use it to train its models. The customer’s spoken lines are generated from text by Deepgram and are not stored by PitchReady. Users can type instead of speaking.</p>
          <p><strong>Practice transcripts and feedback:</strong> deleted automatically after your retention period: 30 days by default, or another period between 1 and 365 days agreed in your order. Users can ask for their own practice data to be deleted from their Settings page. Deleted data in backups will be put beyond ordinary use and removed in accordance with the backup-deletion schedule in the DPA. Any restore must preserve applicable deletion instructions.</p>
          <p>At the end of the service, we will return or delete personal data at your choice in accordance with the DPA, including its export procedure and deletion deadlines. We may retain data where law requires it, subject to appropriate protection and restricted use.</p>
          <p>Our <Link to="/privacy">privacy notice</Link> separately explains personal data for which we act as controller, such as business contact and billing information. The privacy notice does not replace the DPA.</p>

          <h2>11. Availability, support and service changes</h2>
          <p>We will take reasonable steps to maintain the service and address reported faults. Unless an order expressly provides a service-level commitment, we do not promise a particular uptime percentage or response time. We will give reasonable notice of planned material interruptions where practicable.</p>
          <p>We may maintain, update and improve PitchReady. If a planned change materially reduces the functionality you purchased during a paid term, we will give at least 30 days’ notice where reasonably practicable. You may terminate the affected plan by notifying us before the change takes effect, with the refund described in section 6. If urgent security or legal reasons prevent advance notice, we will notify you promptly and give you a reasonable opportunity to exercise that right.</p>

          <h2>12. Suspension</h2>
          <p>We may suspend the affected accounts or functionality where reasonably necessary to address a security threat, unlawful activity, a serious breach of section 7, or overdue undisputed fees after a written reminder allowing at least seven days to pay.</p>
          <p>Suspension must be proportionate. Where lawful and reasonably practicable, we will explain the reason, give an opportunity to resolve it and restore access promptly once it is resolved. Suspension alone does not cancel the agreement or override your rights to data return or deletion under the DPA.</p>

          <h2>13. Ending the agreement</h2>
          <p>Either party may terminate for the other’s material breach if it is not remedied within 14 days after written notice identifying the breach. A party may terminate immediately for a material breach that cannot reasonably be remedied.</p>
          <p>You may cancel renewal under section 6. We may end a rolling subscription for convenience on at least 30 days’ written notice. If we discontinue PitchReady, we will give at least 30 days’ notice where lawful and reasonably practicable, and refund unused prepaid service under section 6. A fixed term otherwise continues until its agreed end date unless these terms or the order permit earlier termination.</p>
          <p>When the agreement ends, your right to use the service ends and outstanding fees for service already supplied remain payable. Managers can download their team’s practice data at any time from the Team page, as a spreadsheet (CSV) or a full data file (JSON). For 30 days after the agreement ends, we will also provide an export on request to the email in section 1. We will handle personal data under the DPA. We will not charge for future renewal periods after effective cancellation.</p>
          <p>Provisions intended to continue, including confidentiality, accrued payment obligations, liability and applicable data-protection provisions, survive termination.</p>

          <h2>14. Events outside reasonable control</h2>
          <p>Neither party is responsible for delay or failure caused by an event outside its reasonable control, provided it promptly informs the other party and takes reasonable steps to reduce the impact. This does not excuse payment for services already supplied or remove applicable data-protection duties. A supplier outage is covered only to the extent it is outside our reasonable control despite appropriate precautions.</p>
          <p>If an event prevents us from supplying the material part of the service for more than 30 consecutive days, you may terminate the affected service and receive a refund for the unused prepaid period.</p>

          <h2>15. Liability</h2>
          <p>Nothing in this agreement excludes or limits liability for death or personal injury caused by negligence, fraud or fraudulent misrepresentation, or any liability that cannot lawfully be excluded or limited.</p>
          <p>Subject to that paragraph, neither party is liable to the other for indirect or consequential loss, or loss of profits, revenue, anticipated savings, business opportunities or goodwill. This does not excuse payment of agreed fees or refunds.</p>
          <p>Subject to the first paragraph, each party’s total aggregate liability arising out of or in connection with the agreement in each consecutive 12-month period starting on its commencement date is limited to the greater of £1,000 and the fees paid or payable under the agreement for that 12-month period. This cap does not limit your obligation to pay agreed fees or our obligation to make refunds expressly due under these terms.</p>
          <p>These limits concern claims between the parties. They do not restrict an individual’s statutory data-protection rights or a regulator’s powers. Each party must take reasonable steps to reduce losses it suffers.</p>

          <h2>16. Changes to these terms</h2>
          <p>We may propose changes by giving you at least 30 days’ written notice explaining material changes and their effective date. Material changes will normally take effect at your next renewal; they will not alter an existing fixed paid term without your agreement, unless a change is required by law.</p>
          <p>If a material change adversely affects you and must take effect before the end of a paid term, you may terminate before it takes effect and receive a proportionate refund for the unused prepaid period. Where law requires a shorter notice period, we will give as much notice as reasonably practicable. We will keep the effective date visible and make the applicable terms available in a form you can save.</p>

          <h2>17. Notices and general provisions</h2>
          <p>Send cancellation and formal notices to the email in section 1. We will send contractual notices to the customer administrator or billing email you provide. Keep those details current. An email notice is treated as received on the next business day after sending, provided the sender receives no delivery-failure notification. This does not govern formal service of court proceedings.</p>
          <p>Neither party may transfer the agreement without the other’s written consent, not to be unreasonably withheld. This agreement does not create a partnership, employment relationship or agency between us.</p>
          <p>If a provision is unenforceable, the remaining provisions continue. A delay in exercising a right does not waive it. A person who is not a party has no right to enforce this agreement under the Contracts (Rights of Third Parties) Act 1999; this does not remove rights available independently under law.</p>
          <p>The agreement is the entire agreement about the service and replaces earlier discussions about it. Nothing in this section excludes liability for fraud or fraudulent misrepresentation.</p>

          <h2>18. Complaints and governing law</h2>
          <p>Contact the email in section 1 with any complaint. We will investigate in good faith and try to resolve it with you.</p>
          <p>The agreement is governed by the laws of England and Wales. The courts of England and Wales have exclusive jurisdiction over disputes arising out of or in connection with it, subject to any mandatory law that applies.</p>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}

/* ------------------------------------------------------------------ Privacy */
export function PrivacyPage() {
  return (
    <div className="lp site">
      <PageHero paint="teal" title="Privacy notice" lede="What information PitchReady collects, why, who it’s shared with, how long it’s kept, and your rights." />
      <section className="site-section" aria-label="Privacy notice">
        <div className="lp-wrap site-prose site-terms">
          <p className="alert warn">Draft for review. This notice has not yet been checked by a solicitor or data protection adviser.</p>
          <p className="small muted">Last updated: 9 November 2026</p>

          <h2>1. Who we are</h2>
          <p>PitchReady is run by Kye Richardson trading as PitchReady (“we”, “us”), based in Kent, United Kingdom. You can contact us about anything in this notice through our <Link to="/contact">contact page</Link>.</p>

          <h2>2. Our role</h2>
          <ul>
            <li><strong>Website visitors and enquiries:</strong> we decide how this information is used (we are the “controller”).</li>
            <li><strong>Practice data in a team’s account</strong> (transcripts, feedback, scores and review notes): the business that invited you decides how it is used, and we process it on their behalf (we are their “processor”). Questions about it can go to your manager or to us.</li>
            <li><strong>Account details</strong> (name, email, sign-in): we use these to run the service, and so does the business that invited you.</li>
          </ul>

          <h2>3. What we collect and why</h2>
          <h3>If you contact us</h3>
          <p>Your name, email address, and anything you choose to tell us: company, team size, kind of sales and your message. We use it only to reply and to talk with you about PitchReady. Our lawful basis is our legitimate interest in answering enquiries, or taking steps you ask for before an agreement.</p>
          <h3>If you have an account</h3>
          <ul>
            <li><strong>Account:</strong> your name, email address, role (manager or rep) and team. Your password is stored by our sign-in provider in scrambled (hashed) form; we never see it.</li>
            <li><strong>Practice:</strong> what you type, the text of what you say, the AI customer’s replies, feedback and scores, reports you send about feedback, and managers’ review notes and corrections.</li>
            <li><strong>Voice:</strong> when you choose to speak, your recording is sent to our speech-to-text provider to turn it into text. PitchReady does not store the recording, and our provider is told not to use it to improve its models.</li>
            <li><strong>Usage:</strong> practice minutes used and the cost of each AI request, kept as totals for billing and fair-use limits.</li>
          </ul>
          <p>We use this to provide the practice and feedback, let managers coach their team, keep the service secure, and manage plans and limits. Our lawful basis is that it is necessary to provide the service the business has asked for (and our legitimate interest in running it securely).</p>
          <h3>Cookies and technical data</h3>
          <p>We use two essential cookies to keep you signed in (for up to 7 and 30 days). We don’t use advertising or analytics cookies. Our servers briefly use your IP address to limit repeated attempts (for example, too many sign-ins), and our hosting provider may keep standard server logs for security.</p>

          <h2>4. Who we share it with</h2>
          <p>We use trusted providers to run PitchReady. They process data only to provide their service to us:</p>
          <ul>
            <li><strong>Railway</strong>: hosting the website and app.</li>
            <li><strong>Supabase</strong>: database and sign-in (data stored in the EU, in Ireland).</li>
            <li><strong>Anthropic</strong>: the AI that plays the customer and writes feedback.</li>
            <li><strong>Deepgram</strong>: turning speech into text and reading the customer’s lines aloud.</li>
            <li><strong>Resend</strong>: sending us an email when you use the contact form.</li>
          </ul>
          <p>Some of these providers are based in, or may process data in, the United States. Where personal data leaves the UK, we rely on the safeguards UK data protection law requires. We never sell personal data, and we don’t use it for advertising.</p>

          <h2>5. How long we keep it</h2>
          <ul>
            <li><strong>Enquiries:</strong> up to 12 months after we receive them, then deleted automatically, unless you become a customer.</li>
            <li><strong>Transcripts, feedback and review notes:</strong> deleted after the team’s retention period, 30 days by default.</li>
            <li><strong>Voice recordings:</strong> not kept by PitchReady.</li>
            <li><strong>Accounts:</strong> while the account is active, then deleted on request or when the team’s agreement ends. When you create an account we record which version of the terms you agreed to, and when.</li>
            <li><strong>Usage totals:</strong> kept for billing and accounting, without any practice text.</li>
          </ul>

          <h2>6. Keeping it safe</h2>
          <p>Data is encrypted in transit. Each team’s data is kept separate at the database level, so one team can never see another’s. Access is limited to what each role needs: reps see their own practice, and managers see their own team.</p>

          <h2>7. Your rights</h2>
          <p>You can ask to see the personal data we hold about you, have it corrected or deleted, restrict or object to how we use it, or receive a copy to take elsewhere. Reps can also request deletion of their practice data in <strong>Settings</strong>. To use any of these rights, contact us through the <Link to="/contact">contact page</Link>. We’ll reply within one month. For practice data, we may involve the business that invited you, because they decide how it is used.</p>
          <p>If you’re unhappy with how we’ve handled your data, you can complain to the Information Commissioner’s Office (ico.org.uk). We’d appreciate the chance to put it right first.</p>

          <h2>8. Children</h2>
          <p>PitchReady is a workplace training tool and is not intended for children.</p>

          <h2>9. Changes</h2>
          <p>We’ll update this notice when how we use data changes, and show the date of the latest version at the top.</p>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
