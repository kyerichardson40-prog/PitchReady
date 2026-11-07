/**
 * Calls the authenticated maintenance route (expire sessions, release reservations, recover
 * evaluation jobs, deletion requests, retention). Schedule it every 5–15 minutes, e.g. a hosting
 * cron or GitHub Actions schedule:  APP_BASE_URL=... MAINTENANCE_SECRET=... node scripts/maintenance.ts
 */
import { loadDotEnv } from '../server/dotenv.ts';

loadDotEnv();
const base = process.env.APP_BASE_URL, secret = process.env.MAINTENANCE_SECRET;
if (!base || !secret) { console.error('Set APP_BASE_URL and MAINTENANCE_SECRET.'); process.exit(2); }
const res = await fetch(`${base.replace(/\/$/, '')}/api/maintenance`, { method: 'POST', headers: { authorization: `Bearer ${secret}`, origin: new URL(base).origin } });
const body = await res.text();
console.log(res.status, body);
process.exit(res.ok ? 0 : 1);
