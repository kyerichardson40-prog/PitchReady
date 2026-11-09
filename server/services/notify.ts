/**
 * Emails the owner when someone sends the contact form. Uses Resend's HTTP API (no SDK).
 *
 * Settings (all read from the environment):
 *  - RESEND_API_KEY        required to send; without it nothing is sent.
 *  - CONTACT_NOTIFY_EMAIL  the inbox that receives the notification; without it nothing is sent.
 *  - CONTACT_FROM_EMAIL    sender. Defaults to Resend's test sender, which can only deliver to the
 *                          email address the Resend account was created with. Use an address on a
 *                          domain verified in Resend to send anywhere else.
 *
 * Best effort: the message is already saved in the database before this runs, so a failed email
 * never fails the form. Plain text only, so nothing a visitor types can become HTML or a link.
 */
export type ContactFields = {
  name: string;
  email: string;
  company?: string;
  team_size?: string;
  sales_type?: string;
  message: string;
};

const DEFAULT_FROM = 'PitchReady <onboarding@resend.dev>';

/** Removes line breaks and control characters (keeps a header such as the subject on one line). */
function oneLine(s: string, max: number): string {
  return s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function contactEmail(f: ContactFields): { subject: string; text: string } {
  const name = oneLine(f.name, 80) || 'someone';
  const company = oneLine(f.company ?? '', 80);
  const subject = `New PitchReady enquiry from ${name}${company ? ` (${company})` : ''}`;
  const rows: [string, string | undefined][] = [
    ['Name', f.name],
    ['Email', f.email],
    ['Company', f.company],
    ['Team size', f.team_size],
    ['Sales type', f.sales_type],
  ];
  const text = [
    'Someone sent a message through the PitchReady contact form.',
    '',
    ...rows.filter(([, v]) => v && v.trim()).map(([k, v]) => `${k}: ${oneLine(v!, 200)}`),
    '',
    'Message:',
    f.message.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ''),
    '',
    '—',
    'Reply to this email to answer them directly.',
  ].join('\n');
  return { subject, text };
}

/** Trims spaces and stray quotes pasted around a setting's value. */
function clean(v: string | undefined): string {
  return (v ?? '').trim().replace(/^["']+|["']+$/g, '').trim();
}

/** Resend's own explanation of a refusal (it names the cause, never the API key). */
async function resendReason(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { name?: string; message?: string };
    return oneLine([j.name, j.message].filter(Boolean).join(': '), 300);
  } catch { return ''; }
}

export type NotifyResult = 'sent' | 'skipped' | 'failed';

export async function notifyContact(
  f: ContactFields,
  opts: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<NotifyResult> {
  const env = opts.env ?? process.env;
  const key = clean(env.RESEND_API_KEY);
  const to = clean(env.CONTACT_NOTIFY_EMAIL);
  if (!key || !to) return 'skipped';
  const from = clean(env.CONTACT_FROM_EMAIL) || DEFAULT_FROM;
  const { subject, text } = contactEmail(f);
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: to.split(',').map((s) => s.trim()).filter(Boolean), reply_to: f.email, subject, text }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
    });
    if (!res.ok) {
      // Log the status and Resend's reason: never the key, and never the visitor's details.
      const reason = await resendReason(res);
      console.error(`[contact] notification email failed: HTTP ${res.status}${reason ? ` (${reason})` : ''}`);
      return 'failed';
    }
    return 'sent';
  } catch (e) {
    console.error(`[contact] notification email failed: ${(e as Error).name}`);
    return 'failed';
  }
}
