/**
 * LOCAL/TEST ONLY seed: two fictional agencies, each with a manager and two reps, plus clearly
 * labelled practice history (a completed session, one with a concern, and one pending evaluation).
 *
 *   # Local Supabase (supabase start):
 *   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres \
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SECRET_KEY=<local secret> node scripts/seed-local.ts
 *
 * Refuses non-local hosts. Each account gets a random password printed ONCE — there are no shared
 * or reusable credentials in the repository. History evaluations are stored as evaluator_kind
 * "mock" (rule-based, not AI).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { PsqlDb, psql } from '../server/db.ts';
import { loadDotEnv } from '../server/dotenv.ts';
import { bootstrapPayload } from '../lib/content/bootstrap-payload.ts';
import { demoEvaluate } from '../lib/demo/evaluator.ts';
import { DEMO_RUBRIC } from '../lib/content/rubric.ts';

loadDotEnv();
const db = process.env.DATABASE_URL;
const sb = process.env.NEXT_PUBLIC_SUPABASE_URL;
const local = (u?: string) => !!u && /@?(127\.0\.0\.1|localhost)(:\d+)?[/]?/.test(u);
if (!db || !local(db)) { console.error('Refusing: DATABASE_URL must point at localhost/127.0.0.1.'); process.exit(2); }
if (sb && !local(sb)) { console.error('Refusing: NEXT_PUBLIC_SUPABASE_URL is not local.'); process.exit(2); }

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const creds: string[] = [];

async function createUser(email: string): Promise<string> {
  if (sb && process.env.SUPABASE_SECRET_KEY) {
    const password = randomBytes(12).toString('base64url');
    const res = await fetch(`${sb}/auth/v1/admin/users`, {
      method: 'POST', headers: { apikey: process.env.SUPABASE_SECRET_KEY, authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    const body: any = await res.json();
    if (!res.ok) throw new Error(`Could not create ${email}: ${res.status}`);
    creds.push(`${email}  ${password}`);
    return body.id;
  }
  // Plain Postgres with the test shim (no Supabase Auth): insert directly.
  const id = randomUUID();
  await psql(db!, `insert into auth.users(id, email, email_confirmed_at) values ('${id}', ${q(email)}, now())`);
  creds.push(`${email}  (no password: test shim, sign-in not available)`);
  return id;
}

const pdb = new PsqlDb(db);
async function history(rep: string, scenario: string, lines: string[], evaluate: boolean) {
  const u = pdb.user('', rep), svc = pdb.service();
  const s: any = await u.rpc('start_session', { scenario_key: scenario, request_id: `seed-${randomUUID()}` });
  await u.rpc('activate_session', { session_id: s.id });
  let seq = 2;
  for (const text of lines) {
    const rid = `seed-${randomUUID()}`;
    const r: any = await u.rpc('commit_rep_turn', { session_id: s.id, expected_sequence: seq, request_id: rid, text });
    if (r.session.status !== 'active') break;
    await svc.rpc('commit_resident_turn', { session_id: s.id, request_id: rid, text: 'Okay.' });
    seq += 2;
  }
  await u.rpc('end_session', { session_id: s.id });
  if (!evaluate) return;
  const job: any = await svc.rpc('claim_evaluation_job', { session_id: s.id });
  const result = demoEvaluate({ transcript: job.transcript, transcriptRevision: job.transcript_revision, rubric: DEMO_RUBRIC, scenarioKey: job.scenario_key, drillKey: null, mustSay: job.campaign?.must_say, neverSay: job.campaign?.never_say });
  result.limitations = ['Seeded history: rule-based mock feedback, not AI.'];
  await svc.rpc('save_evaluation', { session_id: s.id, transcript_revision: job.transcript_revision, status: 'completed', result, evaluator_kind: 'mock', model: 'seed-rules', prompt_version: 'seed' });
}

for (const label of ['a', 'b']) {
  const tag = randomBytes(3).toString('hex');
  const managerEmail = `manager.${label}.${tag}@example.invalid`;
  await createUser(managerEmail);
  const agency = (await psql(db, `select app_private.bootstrap_agency(${q(JSON.stringify(bootstrapPayload({ agencyName: `Fictional Agency ${label.toUpperCase()}`, managerEmail, managerName: `Manager ${label.toUpperCase()} (fictional)` })))}::jsonb)`)).trim();
  const reps: string[] = [];
  for (const n of [1, 2]) {
    const id = await createUser(`rep${n}.${label}.${tag}@example.invalid`);
    await psql(db, `insert into public.memberships(agency_id, user_id, role) values ('${agency}', '${id}', 'rep'); insert into public.profiles(user_id, display_name) values ('${id}', 'Rep ${n}${label.toUpperCase()} (fictional)') on conflict do nothing`);
    reps.push(id);
  }
  await history(reps[0]!, 'busy', ["Hi, I'm Sam from the fictional Neighbourhood Meal Project. Have you got a moment?", "It's an optional £10 monthly gift for community meal sessions, and it's fine to say no."], true);
  await history(reps[0]!, 'sceptical', ["I'm Sam from the fictional project.", 'One hundred percent of every donation goes straight to the people who need it.'], true);
  await history(reps[1]!, 'monthly-giving', ["It's an optional £10 monthly gift.", "I don't have approved information on cancelling, so I'd need to check."], false);
  console.log(`Seeded ${`Fictional Agency ${label.toUpperCase()}`} (${agency})`);
}
console.log('\nLocal test identities (shown once, local only):\n' + creds.map((c) => '  ' + c).join('\n'));
