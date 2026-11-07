/**
 * Manager controls (DECISIONS D25) on real PostgreSQL + migrations + the Supabase shim:
 * agency-written scenarios, archiving, per-rep assignments and the say-rules evidence re-check.
 * Isolation: agency B can never read, assign or start agency A's scenarios. Run: npm run test:db
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { asRole, dropDatabase, freshDatabase, key, seedTwoAgencies, type Fixture } from './harness.ts';
import { psql } from '../../server/db.ts';
import { ApiError } from '../../server/http.ts';

let f: Fixture;
before(async () => { f = await seedTwoAgencies(await freshDatabase()); });
after(async () => { if (f) await dropDatabase(f.url); });

const u = (id: string) => f.db.user('', id);
async function rejects(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof ApiError, `expected ApiError, got ${e}`);
    assert.equal(e.code, code);
    return true;
  });
}
const scenario = (title: string) => ({
  title, persona: 'Jamie, worried about bills', opener: "Money's tight at the moment, sorry.", objection: 'Cost of living',
  goal: 'Acknowledge the worry and end kindly.', allowedEnding: 'A kind goodbye.', behaviour: 'Polite; ends if pushed.', skill: 'Empathy',
});
/** Last line of psql output: the count (earlier lines echo the JWT claims). */
const count = (out: string) => Number(out.trim().split('\n').at(-1));
const keys = async (user: string) => ((await u(user).rpc<any>('my_context')).scenarios as { key: string }[]).map((s) => s.key).sort();
const start = (rep: string, scenarioKey: string) => u(rep).rpc<any>('start_session', { scenario_key: scenarioKey, request_id: key('start') });
const endIt = (rep: string, id: string) => u(rep).rpc('end_session', { session_id: id });

describe('agency-written scenarios', () => {
  let custom = '';
  test('a manager creates one; the key comes from the title; their reps can start it; other agencies cannot see it', async () => {
    const r: any = await u(f.A.manager).rpc('save_scenario', scenario('Worried about money'));
    custom = r.key;
    assert.equal(custom, 'worried-about-money');
    assert.equal(r.version, 1);
    const again: any = await u(f.A.manager).rpc('save_scenario', scenario('Worried about money'));
    assert.equal(again.key, 'worried-about-money-2', 'a second scenario with the same title gets a new key');
    assert.ok((await keys(f.A.rep1)).includes(custom));
    assert.ok(!(await keys(f.B.rep1)).includes(custom));
    const adminB: any = await u(f.B.manager).rpc('scenario_admin');
    assert.ok(!adminB.scenarios.some((s: any) => s.key === custom));
    const s = await start(f.A.rep1, custom);
    assert.equal(s.scenarioTitle, 'Worried about money');
    assert.equal(s.turns[0].text, "Money's tight at the moment, sorry.");
    await endIt(f.A.rep1, s.id);
    await rejects(start(f.B.rep1, custom), 'scenario_not_available');
    // The SECURITY INVOKER helper returns nothing for another agency's id.
    const leaked = await asRole(f.url, 'authenticated', f.B.manager, `select count(*) from app_private.latest_scenarios('${f.A.agency}')`);
    assert.equal(count(leaked), 0);
  });

  test('editing creates a new version; old sessions keep the title they used; versions stay immutable', async () => {
    const r: any = await u(f.A.manager).rpc('save_scenario', { ...scenario('Money worries'), key: custom });
    assert.deepEqual([r.key, r.version], [custom, 2]);
    const mine: any[] = await u(f.A.rep1).rpc('list_my_sessions');
    assert.ok(mine.some((s) => s.scenarioKey === custom && s.scenarioTitle === 'Worried about money'));
    await assert.rejects(psql(f.url, `update public.scenario_versions set title = 'x' where scenario_key = '${custom}'`), /immutable_record/);
    await rejects(u(f.B.manager).rpc('save_scenario', { ...scenario('Hijack'), key: custom }), 'not_found');
  });

  test('archiving hides it from reps, blocks starting it and clears assignments; restoring brings it back', async () => {
    await u(f.A.manager).rpc('set_scenario_assignments', { user_id: f.A.rep2, keys: [custom, 'busy'] });
    await u(f.A.manager).rpc('set_scenario_archived', { key: custom, archived: true });
    assert.ok(!(await keys(f.A.rep1)).includes(custom));
    await rejects(start(f.A.rep1, custom), 'scenario_not_available');
    const admin: any = await u(f.A.manager).rpc('scenario_admin');
    assert.ok(admin.scenarios.find((s: any) => s.key === custom).archived);
    assert.deepEqual(admin.assignments[f.A.rep2], ['busy']);
    await u(f.A.manager).rpc('set_scenario_archived', { key: custom, archived: false });
    assert.ok((await keys(f.A.rep1)).includes(custom));
    await u(f.A.manager).rpc('set_scenario_assignments', { user_id: f.A.rep2, keys: [] });
  });

  test('invalid fields are rejected by the database too', async () => {
    await rejects(u(f.A.manager).rpc('save_scenario', { ...scenario('Fine'), opener: '' }), 'invalid_scenario');
    await rejects(u(f.A.manager).rpc('save_scenario', { ...scenario('Fine'), behaviour: 'x'.repeat(401) }), 'invalid_scenario');
  });
});

describe('per-rep assignments', () => {
  test('an assigned rep sees and can start only their scenarios; others are unaffected; drills still work', async () => {
    await u(f.A.manager).rpc('set_scenario_assignments', { user_id: f.A.rep1, keys: ['busy', 'firm-refusal'] });
    assert.deepEqual(await keys(f.A.rep1), ['busy', 'firm-refusal']);
    await rejects(start(f.A.rep1, 'sceptical'), 'scenario_not_available');
    const s = await start(f.A.rep1, 'busy');
    await endIt(f.A.rep1, s.id);
    const drill: any = await u(f.A.rep1).rpc('start_session', { scenario_key: 'sceptical', drill_key: 'legitimacy', request_id: key('drill') });
    assert.equal(drill.kind, 'drill', 'retry drills suggested by feedback are not blocked by assignments');
    await endIt(f.A.rep1, drill.id);
    assert.ok((await keys(f.A.rep2)).length >= 5, 'a rep without assignments sees every active scenario');
    await u(f.A.manager).rpc('set_scenario_assignments', { user_id: f.A.rep1, keys: [] });
    assert.ok((await keys(f.A.rep1)).length >= 5, 'clearing assignments removes the restriction');
  });

  test('cross-agency and role rules', async () => {
    await rejects(u(f.B.manager).rpc('set_scenario_assignments', { user_id: f.A.rep1, keys: ['busy'] }), 'not_found');
    await rejects(u(f.A.manager).rpc('set_scenario_assignments', { user_id: f.A.manager, keys: ['busy'] }), 'invalid_input');
    await rejects(u(f.A.manager).rpc('set_scenario_assignments', { user_id: f.A.rep1, keys: ['no-such-scenario'] }), 'invalid_scenario');
    await rejects(u(f.A.rep1).rpc('save_scenario', scenario('Rep-made')), 'forbidden');
    await rejects(u(f.A.rep1).rpc('set_scenario_assignments', { user_id: f.A.rep1, keys: [] }), 'forbidden');
    await rejects(u(f.A.rep1).rpc('set_scenario_archived', { key: 'busy', archived: true }), 'forbidden');
    await rejects(u(f.A.rep1).rpc('scenario_admin'), 'forbidden');
  });

  test('direct table access: reps read only their own assignments; nobody writes them directly', async () => {
    await u(f.A.manager).rpc('set_scenario_assignments', { user_id: f.A.rep2, keys: ['busy'] });
    const asRep1 = await asRole(f.url, 'authenticated', f.A.rep1, 'select count(*) from public.scenario_assignments');
    assert.equal(count(asRep1), 0);
    const asRep2 = await asRole(f.url, 'authenticated', f.A.rep2, 'select count(*) from public.scenario_assignments');
    assert.equal(count(asRep2), 1);
    const asB = await asRole(f.url, 'authenticated', f.B.manager, 'select count(*) from public.scenario_assignments');
    assert.equal(count(asB), 0);
    await assert.rejects(asRole(f.url, 'authenticated', f.A.manager, `insert into public.scenario_assignments(agency_id, user_id, scenario_key) values ('${f.A.agency}', '${f.A.rep1}', 'busy')`), /permission denied/);
    await u(f.A.manager).rpc('set_scenario_assignments', { user_id: f.A.rep2, keys: [] });
  });
});

describe('say rules in stored feedback', () => {
  test('published packs carry the rules to reps; the database re-checks the must-say checklist', async () => {
    const ctx: any = await u(f.A.rep1).rpc('my_context');
    assert.deepEqual(ctx.campaign.pack.must_say.map((m: any) => m.id), ['M1', 'M2']);
    assert.ok(ctx.campaign.pack.never_say.length > 0);
    const s = await start(f.A.rep2, 'busy');
    await u(f.A.rep2).rpc('activate_session', { session_id: s.id });
    await u(f.A.rep2).rpc('commit_rep_turn', { session_id: s.id, expected_sequence: 2, request_id: key('t'), text: "Hi, I'm Rep from the fictional project, no pressure at all." });
    await endIt(f.A.rep2, s.id);
    const job: any = await f.db.service().rpc('claim_evaluation_job', { session_id: s.id });
    const dims = ['introduction', 'accuracy', 'listening', 'next_step', 'respect'].map((k) => ({ key: k, score: null, reason: 'Not observed.', evidence: [] }));
    const result = (req: unknown[]) => ({ schema_version: '1.1', rubric_version: job.rubric.version, transcript_revision: 1, dimensions: dims, strength: null, improvement: null, concerns: [], required_statements: req, retry: { objective: 'x', scenario_key: 'busy', drill_key: null, max_seconds: 60 }, limitations: [] });
    const ok: any = await f.db.service().rpc('save_evaluation', {
      session_id: s.id, transcript_revision: 1, status: 'completed', evaluator_kind: 'mock', model: 'm', prompt_version: 'evaluator-v2',
      result: result([{ id: 'M1', said: true, evidence: [{ turn_id: 'rep-1', quote: "Hi, I'm Rep" }] }, { id: 'M2', said: true, evidence: [{ turn_id: 'rep-1', quote: 'no pressure at all' }] }]),
    });
    assert.equal(ok.status, 'completed');
  });
});
