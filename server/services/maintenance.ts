import { getDb } from '../db.ts';
import { runEvaluationJob } from './evaluation.ts';
import { getConfig } from '../config.ts';
import { emailConfigured, managerEmail, sendEmail, taskReminderEmail, type ManagerNotification, type TaskReminder } from './notify.ts';

export type MaintenanceResult = Record<string, unknown> & { evaluations: Record<string, number> };

/**
 * Expire sessions and release reservations, reset stale leases, honour deletion requests, apply
 * retention, then work through pending evaluation jobs (bounded by count and time).
 * Shared by POST /api/maintenance and the in-process scheduler (server/scheduler.ts).
 */
export async function runMaintenance(budgetMs = 50_000): Promise<MaintenanceResult> {
  const result: any = await getDb().service().rpc('maintenance_run', { abandon_grace_seconds: 120 });
  const evaluations: Record<string, number> = {};
  const started = Date.now();
  for (let i = 0; i < 20 && Date.now() - started < budgetMs; i++) {
    const r = await runEvaluationJob();
    if (r === 'none') break;
    evaluations[r] = (evaluations[r] ?? 0) + 1;
  }
  // Enquiry retention (12 months). Skipped quietly until the contact_messages migration is applied.
  let purged: Record<string, unknown> = {};
  try { purged = (await getDb().service().rpc<any>('purge_contact_messages', {})) ?? {}; } catch { /* not installed yet */ }
  // Practice allowances renew by themselves. Skipped quietly until the migration is applied.
  let renewed: Record<string, unknown> = {};
  try { renewed = (await getDb().service().rpc<any>('renew_allowances', {})) ?? {}; } catch { /* not installed yet */ }
  const emails = await sendManagerEmails().catch(() => ({}));
  const reminders = await sendTaskReminders().catch(() => ({}));
  return { ...(result ?? {}), ...purged, ...renewed, ...emails, ...reminders, evaluations };
}

/**
 * Manager emails: newly flagged sessions and the weekly summary. Only claimed from the database
 * when an email service is configured, so nothing is marked as sent while emails can't go out.
 */
export async function sendManagerEmails(): Promise<Record<string, number>> {
  if (!emailConfigured()) return {};
  let due: ManagerNotification[];
  try { due = (await getDb().service().rpc<ManagerNotification[]>('claim_manager_notifications', {})) ?? []; } catch { return {}; }
  let sent = 0;
  const base = getConfig().env.APP_BASE_URL.replace(/\/$/, '');
  for (const n of due) {
    const { subject, text } = managerEmail(n, base);
    if ((await sendEmail({ to: n.managers, subject, text, tag: 'manager' })) === 'sent') sent++;
  }
  return sent ? { manager_emails_sent: sent } : {};
}

/**
 * Practice-task reminders (D44): one email per rep per task, about a day before it's due, only while
 * they still have sessions to do. Claimed only when email can go out; skipped until the migration is applied.
 */
export async function sendTaskReminders(): Promise<Record<string, number>> {
  if (!emailConfigured()) return {};
  let due: TaskReminder[];
  try { due = (await getDb().service().rpc<TaskReminder[]>('claim_task_reminders', {})) ?? []; } catch { return {}; }
  let sent = 0;
  const base = getConfig().env.APP_BASE_URL.replace(/\/$/, '');
  for (const r of due) {
    const { subject, text } = taskReminderEmail(r, base);
    if ((await sendEmail({ to: [r.email], subject, text, tag: 'task-reminder' })) === 'sent') sent++;
  }
  return sent ? { task_reminders_sent: sent } : {};
}
