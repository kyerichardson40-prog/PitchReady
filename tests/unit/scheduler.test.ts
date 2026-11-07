import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTicker, intervalMinutes } from '../../server/scheduler.ts';

test('maintenance interval: default 10, 0/negative/garbage turn it off, clamped to 1..1440', () => {
  assert.equal(intervalMinutes(undefined), 10);
  assert.equal(intervalMinutes(''), 10);
  assert.equal(intervalMinutes('0'), 0);
  assert.equal(intervalMinutes('-5'), 0);
  assert.equal(intervalMinutes('abc'), 0);
  assert.equal(intervalMinutes('0.2'), 1);
  assert.equal(intervalMinutes('15'), 15);
  assert.equal(intervalMinutes('99999'), 1440);
});

test('maintenance ticker: never overlaps, logs only when work was done, never throws', async () => {
  const logs: string[] = []; const errors: string[] = [];
  const log = { log: (m: string) => logs.push(m), error: (m: string) => errors.push(m) } as any;
  let release!: () => void; let calls = 0;
  const tick = createTicker(() => { calls++; return new Promise((r) => { release = () => r({ closed_sessions: 0, evaluations: {} }); }); }, log);
  const first = tick();
  assert.equal(await tick(), 'skipped');
  release(); assert.equal(await first, 'ran');
  assert.equal(calls, 1); assert.deepEqual(logs, []);

  const busyTick = createTicker(async () => ({ closed_sessions: 2, evaluations: { completed: 1 } }), log);
  assert.equal(await busyTick(), 'ran'); assert.equal(logs.length, 1);

  const failing = createTicker(async () => { throw new Error('network down'); }, log);
  assert.equal(await failing(), 'failed'); assert.match(errors[0]!, /network down/);
});
