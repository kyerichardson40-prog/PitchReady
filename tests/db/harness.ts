import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PsqlDb, psql } from '../../server/db.ts';
import { bootstrapPayload } from '../../lib/content/bootstrap-payload.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ADMIN = process.env.PITCHREADY_PG_ADMIN_URL ?? 'postgres://postgres@127.0.0.1:54329/postgres';

export function ensurePostgres(): void {
  if (process.env.SKIP_LOCAL_POSTGRES) return; // CI provides a Postgres service
  execFileSync('bash', [join(root, 'scripts/local-postgres.sh'), 'start'], { stdio: 'ignore' });
}

/** Creates a fresh database with the Supabase shim + all migrations applied. */
export async function freshDatabase(): Promise<string> {
  ensurePostgres();
  const name = `pr_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  await psql(ADMIN, `create database ${name}`);
  const url = ADMIN.replace(/\/[^/]*$/, `/${name}`);
  await psql(url, readFileSync(join(root, 'tests/db/supabase-shim.sql'), 'utf8'));
  const dir = join(root, 'supabase/migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await psql(url, readFileSync(join(dir, f), 'utf8'));
  return url;
}

export async function dropDatabase(url: string) {
  const name = url.split('/').at(-1)!;
  await psql(ADMIN, `drop database if exists ${name} with (force)`).catch(() => {});
}

export interface Fixture {
  url: string;
  db: PsqlDb;
  A: { agency: string; manager: string; rep1: string; rep2: string };
  B: { agency: string; manager: string; rep1: string; rep2: string };
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * A local test account. By default it has already been through the welcome questions (like the
 * accounts that existed before onboarding); pass `onboarded: false` for a brand-new person.
 */
export async function createUser(url: string, email: string, confirmed = true, opts: { onboarded?: boolean } = {}): Promise<string> {
  const id = randomUUID();
  await psql(url, `insert into auth.users(id, email, email_confirmed_at) values ('${id}', ${q(email)}, ${confirmed ? 'now()' : 'null'})`);
  if (opts.onboarded !== false) await psql(url, `insert into public.onboarding_answers(user_id, skipped) values ('${id}', true) on conflict do nothing`);
  return id;
}

/** Two fictional agencies, each with a manager and two reps (local test identities only). */
export async function seedTwoAgencies(url: string, opts: { allowanceSeconds?: number } = {}): Promise<Fixture> {
  const db = new PsqlDb(url);
  const mk = async (label: 'a' | 'b') => {
    const manager = await createUser(url, `manager.${label}@test.invalid`);
    const agency = (await psql(url, `select app_private.bootstrap_agency(${q(JSON.stringify(bootstrapPayload({ agencyName: `Agency ${label.toUpperCase()} (fictional)`, managerEmail: `manager.${label}@test.invalid`, managerName: `Manager ${label.toUpperCase()}`, allowanceSeconds: opts.allowanceSeconds })))}::jsonb)`)).trim();
    const reps: string[] = [];
    for (const n of [1, 2]) {
      const rep = await createUser(url, `rep${n}.${label}@test.invalid`);
      await psql(url, `insert into public.memberships(agency_id, user_id, role) values ('${agency}', '${rep}', 'rep');
        insert into public.profiles(user_id, display_name) values ('${rep}', 'Rep ${n}${label.toUpperCase()}')`);
      reps.push(rep);
    }
    return { agency, manager, rep1: reps[0]!, rep2: reps[1]! };
  };
  return { url, db, A: await mk('a'), B: await mk('b') };
}

/** Raw SQL as a given role, for direct-table-access tests (bypasses app_api). */
export async function asRole(url: string, role: 'authenticated' | 'anon' | 'service_role', userId: string | null, sql: string): Promise<string> {
  const claims = JSON.stringify(userId ? { sub: userId, role } : { role });
  return psql(url, `begin; set local role ${role}; select set_config('request.jwt.claims', ${q(claims)}, true); ${sql}; commit;`);
}

export const key = (p = 'k') => `${p}-${randomUUID()}`;
