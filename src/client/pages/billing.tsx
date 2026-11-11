'use client';
/** Manager: billing (D45). Status from Stripe, and a button into Stripe's own customer portal. */
import { useState } from 'react';
import { useApp, useAsync } from '../app-context.tsx';
import { Link } from '../router.tsx';
import { billingApi, type MyBilling } from '../repo/api-repo.ts';
import { ErrorBox, Loading, fmtDate } from '../components/ui.tsx';
import { useManagerGuard } from './manager-guard.tsx';

const STATUS: Record<string, { text: string; tone: 'ok' | 'warn' | 'bad' }> = {
  active: { text: 'Active', tone: 'ok' }, trialing: { text: 'Trial', tone: 'ok' },
  past_due: { text: 'Payment overdue', tone: 'warn' }, incomplete: { text: 'Waiting for first payment', tone: 'warn' },
  unpaid: { text: 'Unpaid', tone: 'bad' }, canceled: { text: 'Cancelled', tone: 'bad' }, incomplete_expired: { text: 'Not started', tone: 'bad' }, paused: { text: 'Paused', tone: 'warn' },
};

export function ManagerBillingPage() {
  const guard = useManagerGuard();
  const { repo, ctx } = useApp();
  const connected = repo.mode === 'connected' && ctx?.user?.role === 'manager';
  const q = useAsync(() => (connected ? billingApi.get() : Promise.resolve(null)), [connected]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (guard) return guard;
  if (repo.mode === 'demo') return (
    <div className="stack"><h1 className="m0">Billing</h1>
      <div className="card"><p className="m0">Billing isn’t part of the demo. On the real site, managers see their plan, pay invoices, download receipts and update payment details here, through Stripe.</p></div></div>
  );
  const b: MyBilling | null = q.data ?? null;
  const open = async () => {
    setBusy(true); setErr(null);
    try { const r = await billingApi.portal(); window.location.assign(r.url); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  };
  const st = b?.status ? STATUS[b.status] : undefined;
  return (
    <div className="stack">
      <h1 className="m0">Billing</h1>
      {q.loading && !b ? <Loading /> : q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : !b?.linked ? (
        <div className="card">
          <h2>Billing isn’t set up for your team yet</h2>
          <p>PitchReady plans are priced by the size of your team. Tell us about your team and we’ll send you a quote; invoices then arrive by email and appear here.</p>
          <Link className="btn primary" to="/contact">Contact us about a plan</Link>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="spread">
              <h2 className="m0">Your plan</h2>
              {st && <span className={`tag ${st.tone === 'ok' ? 'teal' : st.tone === 'warn' ? 'amber' : 'red'}`}>{st.text}</span>}
            </div>
            {!b.status && <p>Your account is set up. Your first invoice or quote will arrive by email.</p>}
            {b.status && (
              <ul className="summary-list">
                {b.currentPeriodEnd && <li className="neutral">{b.cancelAtPeriodEnd || b.status === 'canceled' ? 'Ends' : 'Renews'} on <strong>{fmtDate(b.currentPeriodEnd)}</strong>.</li>}
                {b.practiceMinutes && <li className="neutral">Includes <strong>{b.practiceMinutes.toLocaleString('en-GB')} minutes</strong> of practice a month for your team.</li>}
                {b.lastInvoiceStatus === 'paid' && b.lastPaidAt && <li className="ok">Last invoice paid on {fmtDate(b.lastPaidAt)}. Thank you.</li>}
                {b.lastInvoiceStatus === 'open' && <li className="warn">You have an invoice waiting to be paid.{b.lastInvoiceUrl && <> <a href={b.lastInvoiceUrl} target="_blank" rel="noreferrer">Pay it now</a>.</>}</li>}
                {b.lastInvoiceStatus === 'payment_failed' && <li className="warn">Your last payment didn’t go through. Stripe will try again; you can update your payment details below.{b.lastInvoiceUrl && <> <a href={b.lastInvoiceUrl} target="_blank" rel="noreferrer">Pay the invoice</a>.</>}</li>}
                {(b.status === 'canceled' || b.status === 'unpaid') && <li className="warn">Practice time won’t renew. Your team can keep practising until the current period runs out. <Link to="/contact">Contact us</Link> to restart.</li>}
              </ul>
            )}
          </div>
          <div className="card">
            <h2>Invoices and payment details</h2>
            <p>Download invoices and receipts, pay an open invoice, or update your card or billing email on Stripe’s secure page.</p>
            {err && <ErrorBox message={err} />}
            <button className="btn primary" disabled={busy || !b.available} onClick={() => void open()}>{busy ? 'Opening…' : 'Open billing on Stripe'}</button>
            {!b.available && <p className="small muted">Billing is temporarily unavailable.</p>}
          </div>
        </>
      )}
    </div>
  );
}
