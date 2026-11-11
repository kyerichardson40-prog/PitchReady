/** Practice tasks (D44): due wording, states, and the demo's version of the rules. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../lib/demo/engine.ts';
import { dueText, taskProgress, taskState } from '../../lib/domain/tasks.ts';

const key = () => Math.random().toString(36).slice(2);
const now = new Date(2026, 10, 11, 10, 0); // Wed 11 Nov 2026, 10am

test('task states and due wording', () => {
  const t = (h: number | null) => ({ target: 3, dueAt: h === null ? null : new Date(now.getTime() + h * 3600_000).toISOString() });
  assert.equal(taskState(t(48), 3, now), 'done');
  assert.equal(taskState(t(-1), 3, now), 'done', 'done beats overdue');
  assert.equal(taskState(t(-1), 1, now), 'overdue');
  assert.equal(taskState(t(5), 1, now), 'due_soon');
  assert.equal(taskState(t(48), 0, now), 'open');
  assert.equal(taskState(t(null), 0, now), 'open');
  assert.equal(dueText(null, now), 'No due date');
  assert.equal(dueText(new Date(2026, 10, 11, 17, 0).toISOString(), now), 'Due today, 5pm');
  assert.equal(dueText(new Date(2026, 10, 12, 23, 59).toISOString(), now), 'Due tomorrow');
  assert.equal(dueText(new Date(2026, 10, 13, 23, 59).toISOString(), now), 'Due Fri 13 Nov');
  assert.equal(dueText(new Date(2026, 10, 9, 23, 59).toISOString(), now), 'Was due Mon 9 Nov');
});

test('demo: manager sets a task; rep progress counts finished full sessions after it was set', () => {
  const s = E.createSeedState();
  s.currentUserId = 'demo-manager';
  const t = E.createTask(s, { scenarioKey: 'busy', target: 2, dueAt: new Date(Date.now() + 86400_000 * 2).toISOString(), note: 'Before Friday' });
  assert.equal(t.everyone, true);
  assert.ok(t.assignees.every((a) => a.done === 0));
  assert.ok(!t.assignees.some((a) => a.name.startsWith('Dev')), 'deactivated reps are left out');
  s.currentUserId = 'demo-rep-sam';
  for (let i = 0; i < 3; i++) {
    const x = E.startSession(s, { scenarioKey: 'busy', drillKey: null, parentSessionId: null, idempotencyKey: key() });
    E.submitTurn(s, x.id, { text: "Hi, I'm Sam from the fictional Neighbourhood Meal Project. Have you got a moment?", expectedSequence: 2, idempotencyKey: key() });
    if (s.sessions.find((y) => y.id === x.id)!.status === 'active') E.endSession(s, x.id, { idempotencyKey: key() }, new Date(Date.now() + 30_000));
  }
  const mine = E.listTasks(s).find((x) => x.id === t.id)!;
  assert.equal(mine.assignees.length, 1, 'a rep only sees themselves');
  assert.equal(mine.assignees[0]!.done, 2, 'capped at the target');
  s.currentUserId = 'demo-manager';
  const team = E.listTasks(s).find((x) => x.id === t.id)!;
  assert.equal(taskProgress(team).finished, 1);
  E.archiveTask(s, t.id);
  assert.ok(!E.listTasks(s).some((x) => x.id === t.id));
  assert.ok(E.listTasks(s, true).find((x) => x.id === t.id)!.archived);
});

test('demo: validation, chosen reps, and reps cannot set tasks', () => {
  const s = E.createSeedState();
  s.currentUserId = 'demo-manager';
  const err = (fn: () => unknown, code: string) => assert.throws(fn, (e: any) => e.code === code);
  err(() => E.createTask(s, { scenarioKey: 'nope', target: 1 }), 'invalid_input');
  err(() => E.createTask(s, { scenarioKey: 'busy', target: 0 }), 'invalid_input');
  err(() => E.createTask(s, { scenarioKey: 'busy', target: 1, dueAt: '2020-01-01T00:00:00Z' }), 'invalid_input');
  err(() => E.createTask(s, { scenarioKey: 'busy', target: 1, repIds: ['demo-rep-dev'] }), 'invalid_input');
  const t = E.createTask(s, { scenarioKey: 'sceptical', target: 1, repIds: ['demo-rep-tom'] });
  assert.deepEqual(t.assignees.map((a) => [a.userId, a.canPractise]), [['demo-rep-tom', false]], 'Tom isn’t assigned this scenario');
  s.currentUserId = 'demo-rep-sam';
  assert.ok(!E.listTasks(s).some((x) => x.id === t.id), 'Sam isn’t on it');
  err(() => E.createTask(s, { scenarioKey: 'busy', target: 1 }), 'forbidden');
  err(() => E.archiveTask(s, t.id), 'forbidden');
});
