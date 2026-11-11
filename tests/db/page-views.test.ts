/** Site visits (DECISIONS D47) on real PostgreSQL + migrations. Run: npm run test:db */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { dropDatabase, freshDatabase, seedTwoAgencies, type Fixture } from './harness.ts';
import { ApiError } from '../../server/http.ts';

let f: Fixture;
before(async () => { f = await seedTwoAgencies(await freshDatabase()); });
after(async () => { if (f) await dropDatabase(f.url); });

test('page views add up per page and source; only entries carry a source; owner sees daily totals, top pages and sources', async () => {
  const s = f.db.service();
  await s.rpc('record_page_view', { path: '/', source: 'google.com', entry: true });
  await s.rpc('record_page_view', { path: '/', source: 'whatsapp', entry: true });
  await s.rpc('record_page_view', { path: '/pricing', source: 'ignored', entry: false });
  await s.rpc('record_page_view', { path: '/pricing', entry: false });
  await assert.rejects(s.rpc('record_page_view', { path: 'nope' }), (e: unknown) => e instanceof ApiError && e.code === 'invalid_input');
  const v: any = await s.rpc('owner_visits', { days: 7 });
  assert.equal(v.daily.length, 7);
  const today = v.daily.at(-1);
  assert.equal(today.views, 4); assert.equal(today.visits, 2);
  assert.ok(today.signups >= 1, 'seeded users count as sign-ups today');
  assert.deepEqual(v.pages.map((x: any) => [x.path, x.views, x.visits]), [['/', 2, 2], ['/pricing', 2, 0]]);
  assert.deepEqual(v.sources.map((x: any) => x.source).sort(), ['google.com', 'whatsapp']);
  await assert.rejects(f.db.user('', f.A.manager).rpc('owner_visits', {}), (e: unknown) => e instanceof ApiError);
  await assert.rejects(f.db.user('', f.A.manager).rpc('record_page_view', { path: '/' }), (e: unknown) => e instanceof ApiError);
});
