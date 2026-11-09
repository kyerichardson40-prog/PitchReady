/**
 * Any kind of sales (DECISIONS D30) and the contact form (D31) on real PostgreSQL + migrations:
 * a retry drill keeps the person from the session it retries (template scenarios work), drill
 * openers are channel-neutral, and contact messages are service-only, validated and capped.
 * Run: npm run test:db
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { dropDatabase, freshDatabase, key, seedTwoAgencies, type Fixture } from './harness.ts';
import { psql } from '../../server/db.ts';
import { ApiError } from '../../server/http.ts';
import { getTemplate } from '../../lib/content/templates.ts';

let f: Fixture;
before(async () => { f = await seedTwoAgencies(await freshDatabase()); });
after(async () => { if (f) await dropDatabase(f.url); });
const u = (id: string) => f.db.user('', id);
const count = (out: string) => Number(out.trim().split('\n').at(-1));

describe('retry drills in any sales setting', () => {
  test('a drill from a template scenario keeps that person and uses the neutral opener', async () => {
    const sc = getTemplate('telesales')!.scenarios[1]!;
    const saved: any = await u(f.A.manager).rpc('save_scenario', sc);
    const s: any = await u(f.A.rep1).rpc('start_session', { scenario_key: saved.key, request_id: key('tpl') });
    await u(f.A.rep1).rpc('end_session', { session_id: s.id });
    const drill: any = await u(f.A.rep1).rpc('start_session', { scenario_key: saved.key, drill_key: 'already-donate', parent_session_id: s.id, request_id: key('drill') });
    assert.equal(drill.kind, 'drill');
    assert.equal(drill.scenarioKey, saved.key, 'the drill keeps the scenario of the session it retries');
    assert.equal(drill.turns[0].text, 'I already have something like this, to be honest.');
    await u(f.A.rep1).rpc('end_session', { session_id: drill.id });
  });

  test('a drill without a parent still falls back to its built-in scenario', async () => {
    const drill: any = await u(f.A.rep2).rpc('start_session', { scenario_key: 'busy', drill_key: 'busy', request_id: key('d2') });
    assert.equal(drill.scenarioKey, 'busy');
    await u(f.A.rep2).rpc('end_session', { session_id: drill.id });
  });
});

describe('contact messages', () => {
  const msg = { name: 'Alex Test', email: 'Alex@Example.com', company: 'Acme', team_size: '6–20 reps', sales_type: 'Phone and telesales', message: 'We would like a pilot for our team.' };

  test('the server can store a message; signed-in users cannot submit or read them', async () => {
    const r: any = await f.db.service().rpc('submit_contact', msg);
    assert.ok(r.id);
    assert.equal(count(await psql(f.url, `select count(*) from public.contact_messages where email = 'alex@example.com'`)), 1, 'email stored lower-case');
    await assert.rejects(u(f.A.manager).rpc('submit_contact', msg), (e: unknown) => e instanceof ApiError);
    const seen = await psql(f.url, `set role authenticated; select count(*) from public.contact_messages;`).catch((e) => String(e));
    assert.match(String(seen), /permission denied/);
  });

  test('bad input is rejected with invalid_input', async () => {
    await assert.rejects(f.db.service().rpc('submit_contact', { ...msg, email: 'not-an-email' }), (e: unknown) => e instanceof ApiError && e.code === 'invalid_input');
    await assert.rejects(f.db.service().rpc('submit_contact', { ...msg, message: '' }), (e: unknown) => e instanceof ApiError && e.code === 'invalid_input');
  });
});
