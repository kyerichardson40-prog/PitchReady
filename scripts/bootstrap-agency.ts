/**
 * One-time, server-side agency bootstrap. NOT exposed to any client or API role:
 * app_private.bootstrap_agency has no grants and runs only via the database owner connection.
 *
 *   DATABASE_URL=postgres://postgres:...@host:5432/postgres \
 *   node scripts/bootstrap-agency.ts --agency-name "Example Agency" --manager-email owner@example.org [--manager-name "Kye"] \
 *     [--allowance-seconds 9000] [--period-days 14] [--seat-limit 5] [--retention-days 30]
 *
 * The manager must already have an auth account (sign up in the app first). Seeds the FICTIONAL
 * demo campaign, five scenarios and generic rubric — replace them with approved content via
 * /manager/campaign before real use.
 */
import { psql } from '../server/db.ts';
import { loadDotEnv } from '../server/dotenv.ts';
import { bootstrapPayload } from '../lib/content/bootstrap-payload.ts';

loadDotEnv();
const a = process.argv.slice(2);
const arg = (name: string) => { const i = a.indexOf(`--${name}`); return i >= 0 ? a[i + 1] : undefined; };
const num = (name: string) => (arg(name) ? Number(arg(name)) : undefined);
const url = process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL to the database owner connection string (server-side only).'); process.exit(2); }
const agencyName = arg('agency-name'), managerEmail = arg('manager-email');
if (!agencyName || !managerEmail) { console.error('Usage: --agency-name <name> --manager-email <email> [...]'); process.exit(2); }
const payload = bootstrapPayload({ agencyName, managerEmail, managerName: arg('manager-name'), allowanceSeconds: num('allowance-seconds') ?? (process.env.PILOT_INCLUDED_SECONDS ? Number(process.env.PILOT_INCLUDED_SECONDS) : undefined), periodDays: num('period-days'), seatLimit: num('seat-limit'), retentionDays: num('retention-days') ?? (process.env.TRANSCRIPT_RETENTION_DAYS ? Number(process.env.TRANSCRIPT_RETENTION_DAYS) : undefined) });
try {
  const id = (await psql(url, `select app_private.bootstrap_agency('${JSON.stringify(payload).replace(/'/g, "''")}'::jsonb)`)).trim();
  console.log(`Agency created: ${id}\nManager ${managerEmail} can now sign in and invite reps from /manager/reps.\nThe campaign is the FICTIONAL demo pack — replace it with approved content before real use.`);
} catch (e: any) {
  console.error('Bootstrap failed:', (e.stderr ?? e.message).split('\n').find((l: string) => l.includes('ERROR') || l.includes('DETAIL')) ?? 'unknown error');
  process.exit(1);
}
