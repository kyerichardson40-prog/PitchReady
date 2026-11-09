/**
 * Practice clock (DECISIONS D35) on real PostgreSQL + migrations: the clock pauses while the AI
 * works on a turn (capped at 90 s a turn), paused time is not charged, and managers choose 3, 5 or
 * 10-minute sessions through the published campaign. Run: npm run test:db
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { dropDatabase, freshDatabase, key, seedTwoAgencies, type Fixture } from './harness.ts';
import { psql } from '../../server/db.ts';

let f: Fixture;
before(async () => { f = await seedTwoAgencies(await freshDatabase(), { allowanceSeconds: 20_000 }); });
after(async () => { if (f) await dropDatabase(f.url); });
const u = (id: string) => f.db.user('', id);
const svc = () => f.db.service();
const one = async (sql: string) => (await psql(f.url, sql)).trim().split('\n').at(-1)!.trim();

async function begin(rep: string, scenario = 'busy') {
  const s: any = await u(rep).rpc('start_session', { scenario_key: scenario, request_id: key('start') });
  return (await u(rep).rpc('activate_session', { session_id: s.id })) as any;
}
/** Moves the session's clock back, as if `secs` seconds had already passed. */
const age = (id: string, secs: number) => psql(f.url, `update public.sessions set started_at = started_at - interval '${secs} seconds', deadline_at = deadline_at - interval '${secs} seconds' where id = '${id}'`);
/** Pretends the AI has been working on the current turn for `secs` seconds. */
const aiWorked = (id: string, secs: number) => psql(f.url, `update public.sessions set turn_lock_at = turn_lock_at - interval '${secs} seconds' where id = '${id}'`);
const deadlineEpoch = (id: string) => one(`select extract(epoch from deadline_at)::bigint from public.sessions where id = '${id}'`).then(Number);

describe('the clock pauses while the AI works', () => {
  test('time spent producing the reply is added back to the deadline and not charged', async () => {
    const s = await begin(f.A.rep1);
    assert.equal(s.maxSeconds, 180);
    assert.equal(s.pausedSeconds, 0);
    const before = await deadlineEpoch(s.id);
    const req = key('turn');
    await u(f.A.rep1).rpc('commit_rep_turn', { session_id: s.id, expected_sequence: 2, request_id: req, text: 'Hello, I am Sam from BrightLine.', source: 'typed' });
    await aiWorked(s.id, 20);
    const after: any = await svc().rpc('commit_resident_turn', { session_id: s.id, request_id: req, text: 'Go on then, quickly.', end: false });
    assert.equal(after.pausedSeconds, 20);
    assert.ok(Math.abs((await deadlineEpoch(s.id)) - before - 20) <= 1, 'deadline moved by the AI time');
    await age(s.id, 50);
    const ended: any = await u(f.A.rep1).rpc('end_session', { session_id: s.id });
    assert.ok(ended.usedSeconds >= 29 && ended.usedSeconds <= 32, `charged ≈ 50 s wall time − 20 s AI time, got ${ended.usedSeconds}`);
  });

  test('a single turn earns at most 90 seconds back', async () => {
    const s = await begin(f.A.rep1);
    const req = key('turn');
    await u(f.A.rep1).rpc('commit_rep_turn', { session_id: s.id, expected_sequence: 2, request_id: req, text: 'Hi there.', source: 'typed' });
    await aiWorked(s.id, 300);
    const after: any = await svc().rpc('commit_resident_turn', { session_id: s.id, request_id: req, text: 'Yes?', end: false });
    assert.equal(after.pausedSeconds, 90);
    await u(f.A.rep1).rpc('end_session', { session_id: s.id });
  });

  test('speech-to-text time counts too, and the deadline cannot pass mid-turn', async () => {
    const s = await begin(f.A.rep2);
    const req = key('audio');
    const b: any = await u(f.A.rep2).rpc('begin_turn', { session_id: s.id, expected_sequence: 2, request_id: req });
    assert.equal(b.ok, true);
    // The deadline was 5 s away when the rep stopped talking; transcription then took 30 s.
    await psql(f.url, `update public.sessions set deadline_at = now() + interval '5 seconds' - interval '30 seconds', started_at = now() - interval '205 seconds' where id = '${s.id}'`);
    await aiWorked(s.id, 30);
    const c: any = await u(f.A.rep2).rpc('commit_rep_turn', { session_id: s.id, expected_sequence: 2, request_id: req, text: 'Sorry, one moment.', source: 'transcribed' });
    assert.equal(c.ok, true, 'the turn is accepted: the transcription time paused the clock');
    const after: any = await svc().rpc('commit_resident_turn', { session_id: s.id, request_id: req, text: 'Okay.', end: false });
    assert.equal(after.status, 'active');
    assert.ok(after.pausedSeconds >= 30);
    await u(f.A.rep2).rpc('end_session', { session_id: s.id });
  });

  test('a failed transcription releases the turn and still credits the time', async () => {
    const s = await begin(f.A.rep2);
    const req = key('audio');
    await u(f.A.rep2).rpc('begin_turn', { session_id: s.id, expected_sequence: 2, request_id: req });
    await aiWorked(s.id, 12);
    await svc().rpc('release_turn', { session_id: s.id, request_id: req });
    const row = await one(`select paused_seconds || ',' || (turn_lock is null) from public.sessions where id = '${s.id}'`);
    assert.equal(row, '12,true');
    await u(f.A.rep2).rpc('end_session', { session_id: s.id });
  });

  test('ending while the AI is still working counts the pause so far', async () => {
    const s = await begin(f.A.rep1);
    await u(f.A.rep1).rpc('commit_rep_turn', { session_id: s.id, expected_sequence: 2, request_id: key('turn'), text: 'Hello.', source: 'typed' });
    await age(s.id, 40);
    await aiWorked(s.id, 15);
    const failed: any = await svc().rpc('fail_session', { session_id: s.id });
    assert.equal(failed.status, 'failed');
    assert.equal(failed.usedSeconds, 0, 'provider failures are refunded');
    assert.equal(failed.pausedSeconds, 15);
  });
});

describe('managers choose the practice length', () => {
  async function publishMinutes(minutes: number | undefined) {
    const admin: any = await u(f.B.manager).rpc('campaign_admin');
    const last = admin.published.at(-1);
    const pack = { ...last.pack };
    if (minutes === undefined) delete pack.practice_minutes; else pack.practice_minutes = minutes;
    await u(f.B.manager).rpc('save_campaign_draft', { pack, rubric: last.rubric.dimensions });
    await u(f.B.manager).rpc('publish_campaign', {});
  }

  test('10-minute campaign: sessions get 600 s and 40 replies; drills stay 60 s / 5', async () => {
    await publishMinutes(10);
    const s = await begin(f.B.rep1);
    assert.equal(s.maxSeconds, 600);
    assert.equal(s.maxRepTurns, 40);
    await u(f.B.rep1).rpc('end_session', { session_id: s.id });
    const d: any = await u(f.B.rep1).rpc('start_session', { scenario_key: 'busy', drill_key: 'busy', request_id: key('drill') });
    assert.equal(d.maxSeconds, 60);
    assert.equal(d.maxRepTurns, 5);
    await u(f.B.rep1).rpc('end_session', { session_id: d.id });
  });

  test('a long session can hold 40 replies (81+ turns)', async () => {
    const s = await begin(f.B.rep2);
    for (let i = 0; i < 40; i++) {
      const req = key('t');
      await u(f.B.rep2).rpc('commit_rep_turn', { session_id: s.id, expected_sequence: 2 + i * 2, request_id: req, text: `Reply ${i + 1}`, source: 'typed' });
      await svc().rpc('commit_resident_turn', { session_id: s.id, request_id: req, text: `Answer ${i + 1}`, end: false });
    }
    const last: any = (await u(f.B.rep2).rpc('get_session', { session_id: s.id }) as any).session;
    assert.equal(last.turns.length, 81);
    await assert.rejects(u(f.B.rep2).rpc('commit_rep_turn', { session_id: s.id, expected_sequence: 82, request_id: key('t'), text: 'One more', source: 'typed' }), /turn_limit|all replies/);
    await u(f.B.rep2).rpc('end_session', { session_id: s.id });
  });

  test('5 minutes → 300 s / 20 replies; no setting → the 3-minute default', async () => {
    await publishMinutes(5);
    let s = await begin(f.B.rep1);
    assert.deepEqual([s.maxSeconds, s.maxRepTurns], [300, 20]);
    await u(f.B.rep1).rpc('end_session', { session_id: s.id });
    await publishMinutes(undefined);
    s = await begin(f.B.rep1);
    assert.deepEqual([s.maxSeconds, s.maxRepTurns], [180, 12]);
    await u(f.B.rep1).rpc('end_session', { session_id: s.id });
  });
});
