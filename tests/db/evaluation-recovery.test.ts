/**
 * Durable evaluation: (1) invalid first output → one bounded repair → validated result;
 * (2) evaluator outage → job stays pending → maintenance worker completes it later.
 * Uses LABELLED mock providers with failure injection.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { dropDatabase, freshDatabase, seedTwoAgencies, type Fixture } from './harness.ts';
import { startServer } from '../e2e/helpers.ts';
import { psql } from '../../server/db.ts';

const SECRET = 'maint-secret-0123456789-abcdefghijklmnop';
let f: Fixture;
const servers: Awaited<ReturnType<typeof startServer>>[] = [];
const env = (url: string, extra: Record<string, string> = {}) => ({ APP_MODE: 'connected', PITCHREADY_TEST_DB_URL: url, AI_PROVIDER: 'mock', AI_BUDGET_CURRENCY: 'GBP', MAINTENANCE_SECRET: SECRET, ...extra });

before(async () => { f = await seedTwoAgencies(await freshDatabase()); });
after(async () => { servers.forEach((s) => s.proc.kill()); if (f) await dropDatabase(f.url); });

async function practise(base: string, userId: string) {
  const h = { origin: base, cookie: `pr_at=${userId}`, 'content-type': 'application/json' };
  const post = async (p: string, b: unknown) => (await fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify(b) })).json() as Promise<any>;
  const s = (await post('/api/sessions', { scenarioKey: 'busy', idempotencyKey: `k-${Math.random()}-${Date.now()}` })).session;
  await post(`/api/sessions/${s.id}/turns`, { text: "Hi, I'm Sam from the fictional Neighbourhood Meal Project. Have you got a moment?", expectedSequence: 2, idempotencyKey: `t-${Math.random()}` });
  const ended = await post(`/api/sessions/${s.id}/end`, { idempotencyKey: `e-${Math.random()}` });
  return ended.id ? ended : (await (await fetch(`${base}/api/sessions/${s.id}`, { headers: h })).json()).session;
}

test('invalid first evaluator output is repaired once and then stored as a validated result', async () => {
  const srv = await startServer(env(f.url, { MOCK_PROVIDER_FAIL: 'evaluate-invalid' }), 3251); servers.push(srv);
  const s = await practise(srv.url, f.A.rep1);
  assert.equal(s.evaluationStatus, 'completed');
  const ops = await psql(f.url, `select string_agg(operation_id, ',' order by created_at) from public.provider_attempts where session_id = '${s.id}' and operation = 'evaluate'`);
  assert.match(ops.trim(), /:repair$/, 'a repair attempt was made');
  assert.equal(ops.trim().split(',').length, 2, 'exactly one repair');
});

test('evaluator outage leaves a durable pending job that maintenance completes later', async () => {
  const down = await startServer(env(f.url, { MOCK_PROVIDER_FAIL: 'evaluate' }), 3252); servers.push(down);
  const s = await practise(down.url, f.A.rep2);
  assert.equal(s.evaluationStatus, 'pending', 'no fake success while the evaluator is down');
  const up = await startServer(env(f.url), 3253); servers.push(up);
  const r = await fetch(up.url + '/api/maintenance', { method: 'POST', headers: { authorization: `Bearer ${SECRET}`, origin: up.url } });
  assert.equal(r.status, 200);
  const st = await psql(f.url, `select evaluation_status from public.sessions where id = '${s.id}'`);
  assert.equal(st.trim(), 'completed');
});
