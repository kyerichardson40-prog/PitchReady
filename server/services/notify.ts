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
type SendOpts = { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; timeoutMs?: number };

/** True when the server has an email service key (emails to people other than the owner also need a verified sender domain). */
export function emailConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!clean(env.RESEND_API_KEY);
}

/**
 * Sends one plain-text email through Resend. Best effort: returns 'failed' rather than throwing,
 * and logs only the status and Resend's reason (never the key, addresses or content).
 */
export async function sendEmail(msg: { to: string[]; subject: string; text: string; replyTo?: string; tag: string }, opts: SendOpts = {}): Promise<NotifyResult> {
  const env = opts.env ?? process.env;
  const key = clean(env.RESEND_API_KEY);
  const to = msg.to.map((x) => x.trim()).filter(Boolean);
  if (!key || to.length === 0) return 'skipped';
  const from = clean(env.CONTACT_FROM_EMAIL) || DEFAULT_FROM;
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, ...(msg.replyTo ? { reply_to: msg.replyTo } : {}), subject: oneLine(msg.subject, 160), text: msg.text }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
    });
    if (!res.ok) {
      const reason = await resendReason(res);
      console.error(`[${msg.tag}] notification email failed: HTTP ${res.status}${reason ? ` (${reason})` : ''}`);
      return 'failed';
    }
    return 'sent';
  } catch (e) {
    console.error(`[${msg.tag}] notification email failed: ${(e as Error).name}`);
    return 'failed';
  }
}

export async function notifyContact(f: ContactFields, opts: SendOpts = {}): Promise<NotifyResult> {
  const to = clean((opts.env ?? process.env).CONTACT_NOTIFY_EMAIL);
  if (!to) return 'skipped';
  const { subject, text } = contactEmail(f);
  return sendEmail({ to: to.split(','), subject, text, replyTo: f.email, tag: 'contact' }, opts);
}

/** Tells the owner that someone started a free pilot (goes to CONTACT_NOTIFY_EMAIL). */
export async function notifyOwner(subject: string, lines: string[], opts: SendOpts = {}): Promise<NotifyResult> {
  const to = clean((opts.env ?? process.env).CONTACT_NOTIFY_EMAIL);
  if (!to) return 'skipped';
  return sendEmail({ to: to.split(','), subject, text: lines.join('\n'), tag: 'owner' }, opts);
}

export function invitationEmail(i: { agencyName: string; inviterName: string; role: 'rep' | 'manager'; link: string; expiresAt: string }): { subject: string; text: string } {
  const team = oneLine(i.agencyName, 80) || 'a team';
  return {
    subject: `You're invited to join ${team} on PitchReady`,
    text: [
      `${oneLine(i.inviterName, 80) || 'Your manager'} has invited you to join ${team} on PitchReady as a ${i.role === 'manager' ? 'manager' : 'sales rep'}.`,
      '',
      'PitchReady lets you practise sales conversations with an AI customer and get feedback on what you said.',
      '',
      'To accept, open this link and sign in or create an account with this email address:',
      i.link,
      '',
      `The link works once and expires on ${new Date(i.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.`,
      "If you weren't expecting this, you can ignore this email.",
    ].join('\n'),
  };
}

export interface ManagerNotification {
  agencyName: string; managers: string[];
  flagged: { sessionId: string; repName: string; scenarioTitle: string; concerns: number }[];
  digest: { sessions: number; reps: number; activeReps: number; averageScore: number | null; flagged: number } | null;
}

/** One email per team: newly flagged sessions and/or the weekly summary. */
export function managerEmail(n: ManagerNotification, baseUrl: string): { subject: string; text: string } {
  const team = oneLine(n.agencyName, 80);
  const lines: string[] = [];
  if (n.digest) {
    const d = n.digest;
    lines.push(`Your team's last 7 days on PitchReady (${team}):`, '',
      `- ${d.sessions} practice session${d.sessions === 1 ? '' : 's'}`,
      `- ${d.reps} of ${d.activeReps} rep${d.activeReps === 1 ? '' : 's'} practised`,
      ...(d.averageScore === null ? [] : [`- Average score: ${d.averageScore} out of 5`]),
      `- ${d.flagged} session${d.flagged === 1 ? '' : 's'} flagged for review`, '');
  }
  if (n.flagged.length) {
    lines.push(n.digest ? 'Newly flagged for review:' : `Flagged for your review (${team}):`, '');
    for (const f of n.flagged) lines.push(`- ${oneLine(f.repName, 60)} · ${oneLine(f.scenarioTitle, 80)} (${f.concerns} concern${f.concerns === 1 ? '' : 's'})`, `  ${baseUrl}/manager/sessions/${f.sessionId}`);
    lines.push('');
  }
  lines.push(`Open your team overview: ${baseUrl}/manager`, '', 'Feedback is coaching, not a certification or an employment decision.',
    'To stop these emails, turn them off under Team → Team settings.');
  const subject = n.digest
    ? `PitchReady weekly summary: ${n.digest.sessions} session${n.digest.sessions === 1 ? '' : 's'}`
    : `PitchReady: ${n.flagged.length} session${n.flagged.length === 1 ? '' : 's'} flagged for review`;
  return { subject, text: lines.join('\n') };
}

/** A practice-task reminder for one rep, sent once, the day before it's due (D44). */
export interface TaskReminder { email: string; name: string; team: string; scenario: string; target: number; done: number; dueAt: string; note: string | null }
export function taskReminderEmail(r: TaskReminder, baseUrl: string): { subject: string; text: string } {
  const left = Math.max(0, r.target - r.done);
  const when = new Date(r.dueAt).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'Europe/London' });
  const lines = [
    `Hi ${oneLine(r.name, 60)},`, '',
    `A reminder from ${oneLine(r.team, 80)}: practise “${oneLine(r.scenario, 80)}” ${r.target} time${r.target === 1 ? '' : 's'} by ${when}.`,
    `You've done ${r.done} so far, so ${left} to go.`,
    ...(r.note ? ['', `Your manager's note: ${oneLine(r.note, 300)}`] : []),
    '', `Practise now: ${baseUrl}/practice`, '', 'PitchReady',
  ];
  return { subject: `Reminder: ${left} practice session${left === 1 ? '' : 's'} due soon`, text: lines.join('\n') };
}
