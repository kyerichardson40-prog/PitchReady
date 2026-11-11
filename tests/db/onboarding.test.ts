/** Welcome questions (DECISIONS D40) on real PostgreSQL + migrations. Run: npm run test:db */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createUser, dropDatabase, freshDatabase, seedTwoAgencies, type Fixture } from './harness.ts';
import { ApiError } from '../../server/http.ts';

let f: Fixture;
before(async () => { f = await seedTwoAgencies(await freshDatabase()); });
after(async () => { if (f) await dropDatabase(f.url); });
const u = (id: string) => f.db.user('', id);

test('people who existed before onboarding are not asked; new accounts are', async () => {
  assert.equal(((await u(f.A.manager).rpc('my_onboarding', {})) as any).done, true);
  const fresh = await createUser(f.url, 'fresh@test.invalid', true, { onboarded: false });
  assert.deepEqual(await u(fresh).rpc('my_onboarding', {}), { done: false });
});

test('a rep answers; their manager sees it; another team does not; skipping counts as done', async () => {
  await u(f.A.rep1).rpc('save_onboarding', { role: 'rep', struggles: ['objections', 'nerves', 'objections'], struggles_other: ' I freeze on price ', goals: ['confidence'], goals_other: '' });
  const mine: any = await u(f.A.rep1).rpc('my_onboarding', {});
  assert.equal(mine.done, true);
  assert.deepEqual([...mine.struggles].sort(), ['nerves', 'objections'], 'duplicates removed');
  const team: any[] = await u(f.A.manager).rpc('team_onboarding', {});
  assert.equal(team.length, 1);
  assert.equal(team[0].strugglesOther, 'I freeze on price');
  assert.equal(team[0].goalsOther, null);
  assert.deepEqual(await u(f.B.manager).rpc('team_onboarding', {}), []);
  await assert.rejects(u(f.A.rep2).rpc('team_onboarding', {}), (e: unknown) => e instanceof ApiError && e.code === 'forbidden');
  await u(f.A.rep2).rpc('save_onboarding', { role: 'rep', struggles: [], goals: [], skipped: true });
  assert.equal(((await u(f.A.rep2).rpc('my_onboarding', {})) as any).done, true);
  assert.equal(((await u(f.A.manager).rpc('team_onboarding', {})) as any[]).length, 1, 'skipped answers are not shown');
});

test('only the owner (service role) sees everyone; nobody reads the table directly', async () => {
  const o: any = await f.db.service().rpc('owner_onboarding', {});
  assert.equal(o.answered, 1);
  assert.equal(o.skipped, 1, 'rep2 skipped; accounts from before onboarding are not counted');
  assert.equal(o.responses[0].email, 'rep1.a@test.invalid');
  await assert.rejects(u(f.A.manager).rpc('owner_onboarding', {}), (e: unknown) => e instanceof ApiError);
  await assert.rejects(u(f.A.rep1).rpc('save_onboarding', { role: 'boss', struggles: [], goals: [] }), (e: unknown) => e instanceof ApiError && e.code === 'invalid_input');
});
