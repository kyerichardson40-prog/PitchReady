/**
 * Real PostgreSQL + migrations + Supabase auth shim. Exercises tenant isolation, role rules,
 * direct table access, idempotency, allowance concurrency, invitations, evaluation integrity,
 * immutability and retention. Run: npm run test:db
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { asRole, createUser, dropDatabase, freshDatabase, key, seedTwoAgencies, type Fixture } from './harness.ts';
import { psql } from '../../server/db.ts';
import { ApiError } from '../../server/http.ts';

let f: Fixture;
before(async () => { f = await seedTwoAgencies(await freshDatabase()); });
after(async () => { if (f) await dropDatabase(f.url); });

const u = (id: string) => f.db.user('', id);
const svc = () => f.db.service();
async function rejects(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof ApiError, `expected ApiError, got ${e}`);
    assert.equal(e.code, code);
    return true;
  });
}
async function deniedSql(p: Promise<unknown>) {
  await assert.rejects(p, /permission denied|violates row-level security|immutable_record/);
}
const tokenPair = () => { const token = randomBytes(32).toString('base64url'); return { token, hash: createHash('sha256').update(token).digest('hex') }; };

async function startAndTalk(rep: string, scenario = 'busy') {
  const s: any = await u(rep).rpc('start_session', { scenario_key: scenario, request_id: key('start') });
  await u(rep).rpc('activate_session', { session_id: s.id });
  const r1 = key('turn');
  await u(rep).rpc('commit_rep_turn', { session_id: s.id, expected_sequence: 2, request_id: r1, text: "Hi, I'm Sam from the fictional project. Have you got a moment?" });
  await svc().rpc('commit_resident_turn', { session_id: s.id, request_id: r1, text: 'Go on then — quickly.' });
  const ended: any = await u(rep).rpc('end_session', { session_id: s.id });
  return ended;
}

describe('tenant isolation', () => {
  let bSession: any;
  before(async () => { bSession = await startAndTalk(f.B.rep1); });

  test('manager A cannot read agency B sessions through RPCs or direct table access', async () => {
    assert.equal(await u(f.A.manager).rpc('get_session', { session_id: bSession.id }), null);
    const sums: any = await u(f.A.manager).rpc('manager_summaries');
    assert.ok(sums.sessions.every((s: any) => s.id !== bSession.id));
    for (const table of ['sessions', 'turns', 'evaluations', 'feedback_reports', 'manager_reviews', 'usage_ledger', 'memberships', 'invitations', 'audit_events', 'provider_attempts']) {
      const out = await asRole(f.url, 'authenticated', f.A.manager, `select count(*) from public.${table} where agency_id = '${f.B.agency}'`);
      assert.equal(out.trim().split('\n').at(-1), '0', `${table} leaked`);
    }
  });

  test('manager A cannot act on B by guessing IDs', async () => {
    await rejects(u(f.A.manager).rpc('add_review', { session_id: bSession.id, note: 'x', resolution: 'noted' }), 'not_found');
    await rejects(u(f.A.manager).rpc('add_correction', { session_id: bSession.id, turn_label: 'rep-1', corrected_text: 'x', request_id: key() }), 'not_found');
    await rejects(u(f.A.manager).rpc('set_member_active', { user_id: f.B.rep2, active: false }), 'not_found');
    await rejects(u(f.A.manager).rpc('request_evaluation', { session_id: bSession.id }), 'not_found');
    const { hash } = tokenPair();
    const inv: any = await u(f.B.manager).rpc('create_invitation', { email: 'x@test.invalid', role: 'rep', token_hash: hash });
    await rejects(u(f.A.manager).rpc('revoke_invitation', { invitation_id: inv.id }), 'not_found');
  });

  test('rep A cannot start a drill with B parent session', async () => {
    await rejects(u(f.A.rep1).rpc('start_session', { scenario_key: 'busy', drill_key: 'busy', parent_session_id: bSession.id, request_id: key() }), 'invalid_parent');
  });
});

describe('rep restrictions', () => {
  let rep2Session: any;
  before(async () => { rep2Session = await startAndTalk(f.A.rep2, 'sceptical'); });

  test("rep A1 cannot read rep A2's transcript", async () => {
    assert.equal(await u(f.A.rep1).rpc('get_session', { session_id: rep2Session.id }), null);
    const n = await asRole(f.url, 'authenticated', f.A.rep1, `select count(*) from public.turns where session_id = '${rep2Session.id}'`);
    assert.equal(n.trim().split('\n').at(-1), '0');
    const ok: any = await u(f.A.rep2).rpc('get_session', { session_id: rep2Session.id });
    assert.equal(ok.session.id, rep2Session.id);
  });

  test('rep cannot write tables directly, grant roles, edit allowance, write evaluations or ledger', async () => {
    await deniedSql(asRole(f.url, 'authenticated', f.A.rep1, `update public.memberships set role = 'manager' where user_id = '${f.A.rep1}'`));
    await deniedSql(asRole(f.url, 'authenticated', f.A.rep1, `insert into public.memberships(agency_id, user_id, role) values ('${f.B.agency}', '${f.A.rep1}', 'manager')`));
    await deniedSql(asRole(f.url, 'authenticated', f.A.rep1, `update public.usage_periods set allowance_seconds = 999999`));
    await deniedSql(asRole(f.url, 'authenticated', f.A.rep1, `insert into public.evaluations(agency_id, session_id, transcript_revision, attempt, status, evaluator_kind, result, prompt_version) values ('${f.A.agency}', '${rep2Session.id}', 1, 1, 'completed', 'mock', '{}', 'x')`));
    await deniedSql(asRole(f.url, 'authenticated', f.A.rep1, `insert into public.usage_ledger(agency_id, period_id, operation_id, kind, seconds) select agency_id, id, 'x', 'adjustment', -9999 from public.usage_periods`));
    await deniedSql(asRole(f.url, 'authenticated', f.A.rep1, `update public.campaign_versions set state = 'published'`));
  });

  test('rep cannot call service-only or manager functions, or bootstrap', async () => {
    await rejects(u(f.A.rep1).rpc('save_evaluation', { session_id: rep2Session.id, transcript_revision: 1, status: 'completed', result: {} }), 'forbidden');
    await rejects(u(f.A.rep1).rpc('commit_resident_turn', { session_id: rep2Session.id, request_id: 'x', text: 'hi' }), 'forbidden');
    await rejects(u(f.A.rep1).rpc('maintenance_run', {}), 'forbidden');
    await rejects(u(f.A.rep1).rpc('begin_provider_attempt', {}), 'forbidden');
    await rejects(u(f.A.rep1).rpc('publish_campaign', {}), 'forbidden');
    await rejects(u(f.A.rep1).rpc('create_invitation', { email: 'a@b.invalid', role: 'manager', token_hash: 'a'.repeat(64) }), 'forbidden');
    await rejects(u(f.A.rep1).rpc('set_member_active', { user_id: f.A.rep1, active: true }), 'forbidden');
    await deniedSql(asRole(f.url, 'authenticated', f.A.rep1, `select app_private.bootstrap_agency('{}'::jsonb)`));
    await deniedSql(asRole(f.url, 'service_role', null, `select app_private.bootstrap_agency('{}'::jsonb)`));
  });

  test('anonymous role has no access', async () => {
    await deniedSql(asRole(f.url, 'anon', null, 'select count(*) from public.sessions'));
    await deniedSql(asRole(f.url, 'anon', null, `select app_api.my_context()`));
  });

  test('member emails: visible to own-agency managers only', async () => {
    const roster: any = await u(f.A.manager).rpc('manager_roster');
    assert.ok(roster.members.some((m: any) => m.email === 'rep1.a@test.invalid'));
    const leak = await asRole(f.url, 'authenticated', f.A.rep1, `select coalesce(app_private.member_email('${f.A.rep2}'), 'none')`);
    assert.equal(leak.trim().split('\n').at(-1), 'none');
    const cross = await asRole(f.url, 'authenticated', f.A.manager, `select coalesce(app_private.member_email('${f.B.rep1}'), 'none')`);
    assert.equal(cross.trim().split('\n').at(-1), 'none');
  });

  test('a manager cannot promote themselves or change their own membership', async () => {
    await rejects(u(f.A.manager).rpc('set_member_active', { user_id: f.A.manager, active: false }), 'forbidden');
  });
});

describe('session integrity', () => {
  test('duplicate start/turn/end requests do not duplicate records or settlements', async () => {
    const rep = f.A.rep1;
    const sk = key('start');
    const s1: any = await u(rep).rpc('start_session', { scenario_key: 'existing-donor', request_id: sk });
    const s2: any = await u(rep).rpc('start_session', { scenario_key: 'existing-donor', request_id: sk });
    assert.equal(s1.id, s2.id);
    await u(rep).rpc('activate_session', { session_id: s1.id });
    const tk = key('turn');
    await u(rep).rpc('commit_rep_turn', { session_id: s1.id, expected_sequence: 2, request_id: tk, text: 'That is great that you already give.' });
    const dup: any = await u(rep).rpc('commit_rep_turn', { session_id: s1.id, expected_sequence: 2, request_id: tk, text: 'That is great that you already give.' });
    assert.equal(dup.duplicate, true);
    // While the resident reply is pending, a different turn cannot interleave.
    await rejects(u(rep).rpc('commit_rep_turn', { session_id: s1.id, expected_sequence: 3, request_id: key(), text: 'second' }), 'turn_in_progress');
    await svc().rpc('commit_resident_turn', { session_id: s1.id, request_id: tk, text: 'So why would this one matter?' });
    await svc().rpc('commit_resident_turn', { session_id: s1.id, request_id: tk, text: 'So why would this one matter?' });
    // Stale expected sequence is rejected.
    await rejects(u(rep).rpc('commit_rep_turn', { session_id: s1.id, expected_sequence: 2, request_id: key(), text: 'old' }), 'stale_sequence');
    await u(rep).rpc('end_session', { session_id: s1.id });
    await u(rep).rpc('end_session', { session_id: s1.id });
    const counts = await psql(f.url, `select (select count(*) from public.turns where session_id = '${s1.id}'), (select count(*) from public.usage_ledger where session_id = '${s1.id}' and kind = 'settlement'), (select count(*) from public.evaluation_jobs where session_id = '${s1.id}')`);
    assert.equal(counts.trim(), '3|1|1');
  });

  test('deadline is enforced by the server clock and survives reload', async () => {
    const rep = f.A.rep1;
    const s: any = await u(rep).rpc('start_session', { scenario_key: 'busy', request_id: key() });
    await u(rep).rpc('activate_session', { session_id: s.id });
    // Simulate time passing: move the server-recorded start back 200 seconds.
    await psql(f.url, `update public.sessions set started_at = now() - interval '200 seconds', deadline_at = now() - interval '20 seconds' where id = '${s.id}'`);
    // Re-activating (e.g. reload) cannot reset the clock.
    const again: any = await u(rep).rpc('activate_session', { session_id: s.id });
    assert.ok(new Date(again.deadlineAt) < new Date());
    const r: any = await u(rep).rpc('commit_rep_turn', { session_id: s.id, expected_sequence: 2, request_id: key(), text: 'late' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'deadline_passed');
    assert.equal(r.session.status, 'ended');
    assert.equal(r.session.usedSeconds, 180);
    assert.equal(r.session.endReason, 'time_limit');
  });

  test('concurrent starts cannot over-reserve allowance', async () => {
    // Shrink agency B's allowance so exactly one 180s reservation fits.
    await psql(f.url, `update public.usage_periods set allowance_seconds = consumed_seconds + reserved_seconds + 300 where agency_id = '${f.B.agency}'`);
    const results = await Promise.allSettled([
      u(f.B.rep1).rpc('start_session', { scenario_key: 'busy', request_id: key() }),
      u(f.B.rep2).rpc('start_session', { scenario_key: 'busy', request_id: key() }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    assert.equal(ok.length, 1);
    assert.equal((failed[0]!.reason as ApiError).code, 'allowance_exhausted');
    const row = await psql(f.url, `select consumed_seconds + reserved_seconds <= allowance_seconds from public.usage_periods where agency_id = '${f.B.agency}'`);
    assert.equal(row.trim(), 't');
    // Tidy: end the one that started.
    const started: any = (ok[0] as PromiseFulfilledResult<any>).value;
    await u(started.repId).rpc('end_session', { session_id: started.id });
    await psql(f.url, `update public.usage_periods set allowance_seconds = 9000 where agency_id = '${f.B.agency}'`);
  });

  test('maintenance recovers expired reservations; unauthenticated/rep callers are refused', async () => {
    const s: any = await u(f.A.rep2).rpc('start_session', { scenario_key: 'busy', request_id: key() });
    await u(f.A.rep2).rpc('activate_session', { session_id: s.id });
    await psql(f.url, `update public.sessions set started_at = now() - interval '10 minutes', deadline_at = now() - interval '7 minutes' where id = '${s.id}'`);
    const before = await psql(f.url, `select reserved_seconds from public.usage_periods where agency_id = '${f.A.agency}'`);
    assert.ok(Number(before) >= 180);
    const out: any = await svc().rpc('maintenance_run', {});
    assert.ok(out.closed_sessions >= 1);
    const st = await psql(f.url, `select status || ',' || used_seconds from public.sessions where id = '${s.id}'`);
    assert.equal(st.trim(), 'abandoned,0', 'no rep turns → abandoned and refunded');
    const after = await psql(f.url, `select reserved_seconds from public.usage_periods where agency_id = '${f.A.agency}'`);
    assert.equal(Number(after), Number(before) - 180);
  });

  test('provider failure refunds allowance but keeps provider cost records', async () => {
    const s: any = await u(f.A.rep2).rpc('start_session', { scenario_key: 'busy', request_id: key() });
    await u(f.A.rep2).rpc('activate_session', { session_id: s.id });
    const op = key('op');
    await svc().rpc('begin_provider_attempt', { session_id: s.id, operation_id: op, operation: 'resident', provider: 'mock', model: 'm', estimated_cost_minor: 5, currency: 'GBP', global_budget_minor: 100000, agency_budget_minor: 100000 });
    const dupe: any = await svc().rpc('begin_provider_attempt', { session_id: s.id, operation_id: op, operation: 'resident', provider: 'mock', model: 'm', estimated_cost_minor: 5, currency: 'GBP', global_budget_minor: 100000, agency_budget_minor: 100000 });
    assert.equal(dupe.existing, true, 'an operation is never launched twice');
    await svc().rpc('finish_provider_attempt', { operation_id: op, state: 'uncertain', error_code: 'timeout', cost_status: 'unknown' });
    const failed: any = await svc().rpc('fail_session', { session_id: s.id });
    assert.equal(failed.status, 'failed');
    assert.equal(failed.usedSeconds, 0);
    const att = await psql(f.url, `select state || ',' || estimated_cost_minor from public.provider_attempts where operation_id = '${op}'`);
    assert.equal(att.trim(), 'uncertain,5');
    const refund = await psql(f.url, `select count(*) from public.usage_ledger where session_id = '${s.id}' and kind = 'refund'`);
    assert.equal(refund.trim(), '1');
  });

  test('spend guard refuses calls beyond the budget', async () => {
    const s: any = await u(f.A.rep2).rpc('start_session', { scenario_key: 'busy', request_id: key() });
    await rejects(svc().rpc('begin_provider_attempt', { session_id: s.id, operation_id: key(), operation: 'resident', provider: 'mock', model: 'm', estimated_cost_minor: 50, currency: 'GBP', global_budget_minor: 10, agency_budget_minor: 100000 }), 'spend_budget_exceeded');
    await rejects(svc().rpc('begin_provider_attempt', { session_id: s.id, operation_id: key(), operation: 'resident', provider: 'mock', model: 'm', estimated_cost_minor: 50, currency: 'GBP', global_budget_minor: 100000, agency_budget_minor: 10 }), 'spend_budget_exceeded');
    await u(f.A.rep2).rpc('end_session', { session_id: s.id });
  });
});

describe('evaluation integrity, revisions and versions', () => {
  test('invalid evidence never becomes a completed evaluation; duplicates are ignored; corrections re-evaluate', async () => {
    const s = await startAndTalk(f.A.rep1, 'monthly-giving');
    const job: any = await svc().rpc('claim_evaluation_job', { session_id: s.id });
    assert.equal(job.transcript_revision, 1);
    const repText = job.transcript.find((t: any) => t.id === 'rep-1').text as string;
    const dims = ['introduction', 'accuracy', 'listening', 'next_step', 'respect'].map((key) => ({ key, score: null, reason: 'Not observed.', evidence: [] as any[] }));
    const checklist = [{ id: 'M1', said: false, evidence: [] }, { id: 'M2', said: false, evidence: [] }];
    const bad = { schema_version: '1.1', rubric_version: 'demo-1', transcript_revision: 1, dimensions: dims.map((d, i) => (i === 0 ? { ...d, score: 3, evidence: [{ turn_id: 'rep-1', quote: 'something they never said' }] } : d)), strength: null, improvement: null, concerns: [], required_statements: checklist, retry: { objective: 'x', scenario_key: 'busy', drill_key: null, max_seconds: 60 }, limitations: [] };
    const r1: any = await svc().rpc('save_evaluation', { session_id: s.id, transcript_revision: 1, status: 'completed', result: bad, evaluator_kind: 'mock', model: 'mock', prompt_version: 'v1' });
    assert.equal(r1.status, 'unavailable');
    const after1: any = await u(f.A.rep1).rpc('get_session', { session_id: s.id });
    assert.equal(after1.session.evaluationStatus, 'unavailable');
    assert.ok(after1.session.evaluations.every((e: any) => e.status !== 'completed'));

    await u(f.A.rep1).rpc('request_evaluation', { session_id: s.id });
    await svc().rpc('claim_evaluation_job', { session_id: s.id });
    const good = { ...bad, dimensions: dims.map((d, i) => (i === 0 ? { ...d, score: 3, evidence: [{ turn_id: 'rep-1', quote: repText.slice(0, 10) }] } : d)) };
    // The must-say checklist must cover the campaign's items, and "said" needs a real rep quote.
    for (const wrong of [
      { ...good, required_statements: [] },
      { ...good, required_statements: [{ id: 'M1', said: true, evidence: [] }, checklist[1]] },
      { ...good, required_statements: [{ id: 'M1', said: true, evidence: [{ turn_id: 'rep-1', quote: 'words never said' }] }, checklist[1]] },
    ]) {
      const r: any = await svc().rpc('save_evaluation', { session_id: s.id, transcript_revision: 1, status: 'completed', result: wrong, evaluator_kind: 'mock', model: 'mock', prompt_version: 'v1' });
      assert.equal(r.status, 'unavailable');
      await u(f.A.rep1).rpc('request_evaluation', { session_id: s.id });
      await svc().rpc('claim_evaluation_job', { session_id: s.id });
    }
    const r2: any = await svc().rpc('save_evaluation', { session_id: s.id, transcript_revision: 1, status: 'completed', result: good, evaluator_kind: 'mock', model: 'mock', prompt_version: 'v1' });
    assert.equal(r2.status, 'completed');
    const r3: any = await svc().rpc('save_evaluation', { session_id: s.id, transcript_revision: 1, status: 'completed', result: good, evaluator_kind: 'mock', model: 'mock', prompt_version: 'v1' });
    assert.equal(r3.duplicate, true);
    const n = await psql(f.url, `select count(*) from public.evaluations where session_id = '${s.id}' and status = 'completed'`);
    assert.equal(n.trim(), '1');

    // Manager correction → revision 2 + a new job; revision-1 feedback stays.
    const corrected: any = await u(f.A.manager).rpc('add_correction', { session_id: s.id, turn_label: 'rep-1', corrected_text: 'Hi, I am Sam from the fictional project. Have you got a moment?', request_id: key() });
    assert.equal(corrected.transcriptRevision, 2);
    assert.equal(corrected.turns.find((t: any) => t.id === 'rep-1').text, repText, 'original turn unchanged');
    const job2: any = await svc().rpc('claim_evaluation_job', { session_id: s.id });
    assert.equal(job2.transcript_revision, 2);
    assert.match(job2.transcript.find((t: any) => t.id === 'rep-1').text, /I am Sam/);
    await deniedSql(psql(f.url, `update public.turns set text = 'tampered' where session_id = '${s.id}'`));
    await deniedSql(psql(f.url, `update public.evaluations set result = '{}' where session_id = '${s.id}'`));
  });

  test('publishing a new pack/rubric does not modify older sessions; published versions are frozen', async () => {
    const s = await startAndTalk(f.A.rep2, 'busy');
    const admin: any = await u(f.A.manager).rpc('campaign_admin');
    const pack = { ...admin.published.at(-1).pack, name: 'Edited fictional pack' };
    const rubric = admin.published.at(-1).rubric.dimensions.map((d: any, i: number) => (i === 0 ? { ...d, label: 'Opening' } : d));
    await u(f.A.manager).rpc('save_campaign_draft', { pack, rubric });
    const pub: any = await u(f.A.manager).rpc('publish_campaign', {});
    assert.equal(pub.version, 2);
    const old: any = await u(f.A.rep2).rpc('get_session', { session_id: s.id });
    assert.equal(old.session.campaignVersion, 1);
    assert.equal(old.session.rubricVersion, 'demo-1');
    const ctx: any = await u(f.A.rep1).rpc('my_context');
    assert.equal(ctx.campaign.version, 2);
    assert.equal(ctx.campaign.rubricVersion, 'v2');
    await deniedSql(psql(f.url, `update public.campaign_versions set pack = '{}' where agency_id = '${f.A.agency}' and version = 1 and state = 'published'`));
    // Agency B is untouched.
    const bctx: any = await u(f.B.rep1).rpc('my_context');
    assert.equal(bctx.campaign.version, 1);
  });

  test('manager review is append-only and can resolve a linked report', async () => {
    const s = await startAndTalk(f.B.rep2, 'busy');
    const rep: any = await u(f.B.rep2).rpc('report_feedback', { session_id: s.id, reason: 'transcription_error', description: 'I said monthly.' });
    await u(f.B.manager).rpc('add_review', { session_id: s.id, note: 'Checked.', resolution: 'resolved', report_id: rep.id });
    const st = await psql(f.url, `select status from public.feedback_reports where id = '${rep.id}'`);
    assert.equal(st.trim(), 'resolved');
    await deniedSql(psql(f.url, `delete from public.manager_reviews where session_id = '${s.id}'`));
  });
});

describe('invitations', () => {
  test('accept once with matching confirmed email; reject reused, wrong-email, expired, revoked, unconfirmed', async () => {
    const good = tokenPair();
    await u(f.A.manager).rpc('create_invitation', { email: 'New.Starter@test.invalid', role: 'rep', token_hash: good.hash });
    const newbie = await createUser(f.url, 'new.starter@test.invalid');
    const other = await createUser(f.url, 'someone.else@test.invalid');
    const insp: any = await svc().rpc('inspect_invitation', { token_hash: good.hash, user_id: other });
    assert.equal(insp.status, 'wrong_email');
    await rejects(u(other).rpc('accept_invitation', { token_hash: good.hash }), 'invitation_wrong_email');
    const ok: any = await u(newbie).rpc('accept_invitation', { token_hash: good.hash });
    assert.equal(ok.role, 'rep');
    await rejects(u(newbie).rpc('accept_invitation', { token_hash: good.hash }), 'invitation_used');
    const ctx: any = await u(newbie).rpc('my_context');
    assert.equal(ctx.membership.role, 'rep');

    const exp = tokenPair();
    await u(f.A.manager).rpc('create_invitation', { email: 'late@test.invalid', role: 'rep', token_hash: exp.hash });
    await psql(f.url, `update public.invitations set expires_at = now() - interval '1 minute' where token_hash = decode('${exp.hash}', 'hex')`);
    const late = await createUser(f.url, 'late@test.invalid');
    await rejects(u(late).rpc('accept_invitation', { token_hash: exp.hash }), 'invitation_expired');

    const rev = tokenPair();
    const inv: any = await u(f.A.manager).rpc('create_invitation', { email: 'revoked@test.invalid', role: 'manager', token_hash: rev.hash });
    await u(f.A.manager).rpc('revoke_invitation', { invitation_id: inv.id });
    const revoked = await createUser(f.url, 'revoked@test.invalid');
    await rejects(u(revoked).rpc('accept_invitation', { token_hash: rev.hash }), 'invitation_revoked');

    const unc = tokenPair();
    await u(f.A.manager).rpc('create_invitation', { email: 'unconfirmed@test.invalid', role: 'rep', token_hash: unc.hash });
    const unconfirmed = await createUser(f.url, 'unconfirmed@test.invalid', false);
    await rejects(u(unconfirmed).rpc('accept_invitation', { token_hash: unc.hash }), 'email_unconfirmed');

    await rejects(u(newbie).rpc('accept_invitation', { token_hash: 'ab'.repeat(32) }), 'invitation_invalid');
    const tokens = await psql(f.url, `select count(*) from public.audit_events where metadata::text ilike '%${good.token.slice(0, 12)}%' or metadata::text ilike '%${good.hash.slice(0, 12)}%'`);
    assert.equal(tokens.trim(), '0', 'no token material in audit');
  });

  test('seat limit counts active reps plus pending invitations', async () => {
    await psql(f.url, `update public.agencies set seat_limit = 3 where id = '${f.B.agency}'`);
    await u(f.B.manager).rpc('create_invitation', { email: 'seat1@test.invalid', role: 'rep', token_hash: tokenPair().hash }).catch(() => {});
    await rejects(u(f.B.manager).rpc('create_invitation', { email: 'seat2@test.invalid', role: 'rep', token_hash: tokenPair().hash }), 'seat_limit');
    await psql(f.url, `update public.agencies set seat_limit = 50 where id = '${f.B.agency}'`);
  });
});

describe('deactivation and retention', () => {
  test('deactivated member cannot continue an existing session or read previous records', async () => {
    const victim = await createUser(f.url, `victim.${Date.now()}@test.invalid`);
    await psql(f.url, `insert into public.memberships(agency_id, user_id, role) values ('${f.B.agency}', '${victim}', 'rep'); insert into public.profiles values ('${victim}', 'Victim', now())`);
    const done = await startAndTalk(victim);
    const live: any = await u(victim).rpc('start_session', { scenario_key: 'busy', request_id: key() });
    await u(victim).rpc('activate_session', { session_id: live.id });
    await u(f.B.manager).rpc('set_member_active', { user_id: victim, active: false });
    await rejects(u(victim).rpc('commit_rep_turn', { session_id: live.id, expected_sequence: 2, request_id: key(), text: 'still here' }), 'membership_inactive');
    assert.equal(await u(victim).rpc('get_session', { session_id: done.id }), null);
    const mine: any = await u(victim).rpc('list_my_sessions');
    assert.deepEqual(mine, []);
    const st = await psql(f.url, `select status || ',' || end_reason from public.sessions where id = '${live.id}'`);
    assert.equal(st.trim(), 'ended,membership_revoked');
  });

  test('retention deletes transcript content consistently and keeps aggregate usage', async () => {
    const s = await startAndTalk(f.B.rep1, 'busy');
    await psql(f.url, `update public.sessions set ended_at = now() - interval '40 days' where id = '${s.id}'`);
    const ledgerBefore = await psql(f.url, `select count(*) from public.usage_ledger where session_id = '${s.id}'`);
    const out: any = await svc().rpc('maintenance_run', {});
    assert.ok(out.retention_deleted_sessions >= 1);
    const left = await psql(f.url, `select (select count(*) from public.sessions where id = '${s.id}') + (select count(*) from public.turns where session_id = '${s.id}') + (select count(*) from public.evaluation_jobs where session_id = '${s.id}')`);
    assert.equal(left.trim(), '0');
    const ledgerAfter = await psql(f.url, `select count(*) from public.usage_ledger where session_id = '${s.id}'`);
    assert.equal(ledgerAfter.trim(), ledgerBefore.trim());
    const leaked = await psql(f.url, `select count(*) from public.audit_events where metadata::text ilike '%fictional project%'`);
    assert.equal(leaked.trim(), '0');
  });

  test('deletion request is honoured by maintenance', async () => {
    const s = await startAndTalk(f.A.rep2, 'busy');
    await u(f.A.rep2).rpc('request_deletion', { scope: 'my_transcripts' });
    await svc().rpc('maintenance_run', {});
    const n = await psql(f.url, `select count(*) from public.sessions where id = '${s.id}'`);
    assert.equal(n.trim(), '0');
  });
});
