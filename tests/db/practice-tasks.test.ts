/** Practice tasks (DECISIONS D44) on real PostgreSQL + migrations. Run: npm run test:db */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { dropDatabase, freshDatabase, key, seedTwoAgencies, type Fixture } from './harness.ts';
import { psql } from '../../server/db.ts';
import { ApiError } from '../../server/http.ts';

let f: Fixture;
before(async () => { f = await seedTwoAgencies(await freshDatabase()); });
after(async () => { if (f) await dropDatabase(f.url); });
const u = (id: string) => f.db.user('', id);
const code = (c: string) => (e: unknown) => e instanceof ApiError && e.code === c;

async function practise(rep: string, scenario = 'busy') {
  const s: any = await u(rep).rpc('start_session', { scenario_key: scenario, request_id: key('s') });
  await u(rep).rpc('activate_session', { session_id: s.id });
  await u(rep).rpc('commit_rep_turn', { session_id: s.id, expected_sequence: 2, request_id: key('t'), text: 'Hello there.', source: 'typed' });
  await u(rep).rpc('end_session', { session_id: s.id });
}

test('a manager sets a task for everyone; each rep’s progress counts their finished sessions since then', async () => {
  // A session before the task doesn't count.
  await practise(f.A.rep1);
  const t: any = await u(f.A.manager).rpc('create_task', { scenario_key: 'busy', target_count: 2, due_at: new Date(Date.now() + 3 * 86400_000).toISOString(), note: 'Before Friday’s campaign' });
  assert.equal(t.target, 2);
  assert.equal(t.everyone, true);
  assert.equal(t.assignees.length, 2);
  await practise(f.A.rep1);
  await practise(f.A.rep1, 'sceptical'); // other scenario: doesn't count
  const mine: any[] = await u(f.A.rep1).rpc('list_tasks', {});
  assert.equal(mine.length, 1);
  assert.equal(mine[0].assignees.length, 1, 'a rep only sees their own progress');
  assert.equal(mine[0].assignees[0].done, 1);
  await practise(f.A.rep1); await practise(f.A.rep1);
  const team: any[] = await u(f.A.manager).rpc('list_tasks', {});
  const byName = Object.fromEntries(team[0].assignees.map((a: any) => [a.name, a.done]));
  assert.equal(Math.max(...Object.values(byName) as number[]), 2, 'capped at the target');
  assert.deepEqual(await u(f.B.manager).rpc('list_tasks', {}), [], 'other teams see nothing');
});

test('tasks for chosen reps; validation; only managers set and archive', async () => {
  const t: any = await u(f.A.manager).rpc('create_task', { scenario_key: 'sceptical', target_count: 1, rep_ids: [f.A.rep2] });
  assert.deepEqual(t.assignees.map((a: any) => a.userId), [f.A.rep2]);
  assert.equal(((await u(f.A.rep1).rpc('list_tasks', {})) as any[]).some((x) => x.id === t.id), false);
  await assert.rejects(u(f.A.manager).rpc('create_task', { scenario_key: 'nope', target_count: 1 }), code('invalid_input'));
  await assert.rejects(u(f.A.manager).rpc('create_task', { scenario_key: 'busy', target_count: 0 }), code('invalid_input'));
  await assert.rejects(u(f.A.manager).rpc('create_task', { scenario_key: 'busy', target_count: 1, due_at: '2020-01-01T00:00:00Z' }), code('invalid_input'));
  await assert.rejects(u(f.A.manager).rpc('create_task', { scenario_key: 'busy', target_count: 1, rep_ids: [f.B.rep1] }), code('invalid_input'));
  await assert.rejects(u(f.A.rep1).rpc('create_task', { scenario_key: 'busy', target_count: 1 }), code('forbidden'));
  await assert.rejects(u(f.B.manager).rpc('archive_task', { task_id: t.id }), code('not_found'));
  await u(f.A.manager).rpc('archive_task', { task_id: t.id });
  assert.equal(((await u(f.A.rep2).rpc('list_tasks', {})) as any[]).some((x) => x.id === t.id), false);
  assert.equal(((await u(f.A.manager).rpc('list_tasks', { include_archived: true })) as any[]).find((x) => x.id === t.id).archived, true);
});

test('reminders: once per rep per task, the day before, only if unfinished; server only', async () => {
  const t: any = await u(f.A.manager).rpc('create_task', { scenario_key: 'monthly-giving', target_count: 1, due_at: new Date(Date.now() + 5 * 3600_000).toISOString() });
  await practise(f.A.rep2, 'monthly-giving');
  const first: any[] = await f.db.service().rpc('claim_task_reminders', {});
  const forTask = first.filter((r) => r.scenario && r.target === 1 && r.done === 0);
  assert.ok(forTask.some((r) => r.email === 'rep1.a@test.invalid'), 'rep1 has not done it');
  assert.ok(!first.some((r) => r.email === 'rep2.a@test.invalid' && r.scenario === forTask[0].scenario), 'rep2 already did it');
  assert.deepEqual(await f.db.service().rpc('claim_task_reminders', {}), [], 'never twice');
  await assert.rejects(u(f.A.manager).rpc('claim_task_reminders', {}), (e: unknown) => e instanceof ApiError);
  assert.equal(await psql(f.url, `select count(*) from public.practice_task_reminders where task_id = '${t.id}'`).then((s) => s.trim().split('\n').at(-1)!.trim()), '1');
});
