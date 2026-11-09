/**
 * Accounts and emails (DECISIONS D37) on real PostgreSQL + migrations: allowance renewal, profile
 * and team settings, self-serve pilots, and what managers are emailed. Run: npm run test:db
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createUser, dropDatabase, freshDatabase, key, seedTwoAgencies, type Fixture } from './harness.ts';
import { psql } from '../../server/db.ts';
import { ApiError } from '../../server/http.ts';
import { bootstrapPayload } from '../../lib/content/bootstrap-payload.ts';

let f: Fixture;
before(async () => { f = await seedTwoAgencies(await freshDatabase()); });
after(async () => { if (f) await dropDatabase(f.url); });
const u = (id: string) => f.db.user('', id);
const svc = () => f.db.service();
const one = async (sql: string) => (await psql(f.url, sql)).trim().split('\n').at(-1)!.trim();
const code = (c: string) => (e: unknown) => e instanceof ApiError && e.code === c;

describe('practice allowance renews by itself', () => {
  test('nothing happens while the current period has time left; a new period follows on when it ends', async () => {
    assert.equal(await one(`select renew_allowance_seconds from public.agencies where id = '${f.A.agency}'`), '9000');
    assert.deepEqual(await svc().rpc('renew_allowances', {}), { allowances_renewed: 0 });
    await psql(f.url, `update public.usage_periods set starts_at = now() - interval '14 days', ends_at = now() + interval '10 minutes' where agency_id = '${f.A.agency}'`);
    const r: any = await svc().rpc('renew_allowances', {});
    assert.equal(r.allowances_renewed, 1, 'only agency A is about to run out');
    assert.equal(await one(`select count(*) from public.usage_periods where agency_id = '${f.A.agency}'`), '2');
    assert.equal(await one(`select (starts_at = (select min(ends_at) from public.usage_periods where agency_id = '${f.A.agency}')) and allowance_seconds = 9000 and ends_at = starts_at + interval '30 days' from public.usage_periods where agency_id = '${f.A.agency}' order by starts_at desc limit 1`), 't');
    assert.deepEqual(await svc().rpc('renew_allowances', {}), { allowances_renewed: 0 }, 'idempotent');
  });

  test('a lapsed team gets a fresh period and can practise again; teams without renewal do not', async () => {
    await psql(f.url, `update public.usage_periods set starts_at = now() - interval '20 days', ends_at = now() - interval '1 day' where agency_id = '${f.B.agency}'`);
    await assert.rejects(u(f.B.rep1).rpc('start_session', { scenario_key: 'busy', request_id: key('s') }), code('no_usage_period'));
    await svc().rpc('renew_allowances', {});
    const s: any = await u(f.B.rep1).rpc('start_session', { scenario_key: 'busy', request_id: key('s') });
    assert.ok(s.id);
    await u(f.B.rep1).rpc('end_session', { session_id: s.id });
    await psql(f.url, `update public.agencies set renew_allowance_seconds = null where id = '${f.B.agency}'; update public.usage_periods set ends_at = now() - interval '1 minute', starts_at = now() - interval '40 days' where agency_id = '${f.B.agency}'`);
    assert.deepEqual(await svc().rpc('renew_allowances', {}), { allowances_renewed: 0 });
  });

  test('reps and managers cannot trigger renewal', async () => {
    await assert.rejects(u(f.A.manager).rpc('renew_allowances', {}), (e: unknown) => e instanceof ApiError);
  });
});

describe('profile and team settings', () => {
  test('anyone signed in can change their own name; it is trimmed and bounded', async () => {
    const r: any = await u(f.A.rep1).rpc('update_profile', { display_name: '  Sam   Jones ' });
    assert.equal(r.displayName, 'Sam Jones');
    const ctx: any = await u(f.A.rep1).rpc('my_context');
    assert.equal(ctx.profile.displayName, 'Sam Jones');
    await assert.rejects(u(f.A.rep1).rpc('update_profile', { display_name: ' ' }), code('invalid_input'));
    await assert.rejects(u(f.A.rep1).rpc('update_profile', { display_name: 'x'.repeat(81) }), code('invalid_input'));
  });

  test('only managers change retention and emails, within limits, for their own team', async () => {
    await assert.rejects(u(f.A.rep1).rpc('update_agency_settings', { retention_days: 7 }), code('forbidden'));
    await assert.rejects(u(f.A.manager).rpc('update_agency_settings', { retention_days: 0 }), code('invalid_input'));
    const r: any = await u(f.A.manager).rpc('update_agency_settings', { retention_days: 60, email_notifications: false });
    assert.deepEqual(r, { retentionDays: 60, emailNotifications: false });
    const ctx: any = await u(f.A.manager).rpc('my_context');
    assert.equal(ctx.agency.retentionDays, 60);
    assert.equal(ctx.agency.emailNotifications, false);
    assert.equal(await one(`select retention_days from public.agencies where id = '${f.B.agency}'`), '30', 'other team untouched');
    const partial: any = await u(f.A.manager).rpc('update_agency_settings', { retention_days: null, email_notifications: true });
    assert.deepEqual(partial, { retentionDays: 60, emailNotifications: true });
  });
});

describe('free pilots people start themselves', () => {
  const payload = bootstrapPayload({ agencyName: 'x', managerEmail: 'x@x.invalid', allowanceSeconds: 3600, periodDays: 14 });
  const start = (userId: string, extra: Record<string, unknown> = {}) => svc().rpc('create_pilot_agency', { user_id: userId, agency_name: 'New Team Ltd', manager_name: 'Nina', payload, ...extra });

  test('a confirmed person with no team becomes manager of a new team with a small allowance that does not renew', async () => {
    const nina = await createUser(f.url, 'nina@test.invalid');
    const r: any = await start(nina);
    assert.ok(r.agencyId);
    const ctx: any = await u(nina).rpc('my_context');
    assert.equal(ctx.membership.role, 'manager');
    assert.equal(ctx.agency.name, 'New Team Ltd');
    assert.equal(ctx.profile.displayName, 'Nina');
    assert.equal(ctx.usage.allowanceSeconds, 3600);
    assert.equal(ctx.scenarios.length, 5);
    assert.equal(await one(`select renew_allowance_seconds is null from public.agencies where id = '${r.agencyId}'`), 't');
    await assert.rejects(start(nina), code('already_member'));
    // Even after leaving the team, the same person cannot take a second free pilot.
    await psql(f.url, `delete from public.memberships where user_id = '${nina}'`);
    await assert.rejects(start(nina), code('pilot_used'));
  });

  test('unconfirmed emails, existing members and bad names are refused; signed-in users cannot call it directly', async () => {
    const pending = await createUser(f.url, 'pending@test.invalid', false);
    await assert.rejects(start(pending), code('email_unconfirmed'));
    await assert.rejects(start(f.A.rep1), code('already_member'));
    const ok = await createUser(f.url, 'ok@test.invalid');
    await assert.rejects(start(ok, { agency_name: ' ' }), code('invalid_input'));
    await assert.rejects(u(ok).rpc('create_pilot_agency', { user_id: ok, agency_name: 'Sneaky', payload }), (e: unknown) => e instanceof ApiError);
  });

  test('there is a daily cap across the whole service', async () => {
    const a = await createUser(f.url, 'cap@test.invalid');
    await assert.rejects(start(a, { daily_cap: 1 }), code('rate_limited'));
  });
});

describe('manager emails', () => {
  test('newly flagged sessions are handed over once; the weekly summary once a week; opt-out is respected', async () => {
    await psql(f.url, `update public.usage_periods set starts_at = now() - interval '1 day', ends_at = now() + interval '20 days' where agency_id = '${f.A.agency}'`);
    const s: any = await u(f.A.rep2).rpc('start_session', { scenario_key: 'busy', request_id: key('s') });
    await u(f.A.rep2).rpc('activate_session', { session_id: s.id });
    await u(f.A.rep2).rpc('commit_rep_turn', { session_id: s.id, expected_sequence: 2, request_id: key('t'), text: 'It is guaranteed.', source: 'typed' });
    await u(f.A.rep2).rpc('end_session', { session_id: s.id });
    const result = { dimensions: [{ key: 'introduction', score: 2 }, { key: 'accuracy', score: 4 }], concerns: [{ type: 'unsupported_campaign_claim' }] };
    await psql(f.url, `insert into public.evaluations(agency_id, session_id, transcript_revision, attempt, status, evaluator_kind, result, prompt_version)
      values ('${f.A.agency}', '${s.id}', 1, 1, 'completed', 'mock', '${JSON.stringify(result)}'::jsonb, 'test')`);
    await psql(f.url, `update public.agencies set digest_sent_at = now() - interval '8 days'`);

    const first: any[] = await svc().rpc('claim_manager_notifications', {});
    const a = first.find((x) => x.agencyName.startsWith('Agency A'))!;
    assert.deepEqual(a.managers, ['manager.a@test.invalid']);
    assert.equal(a.flagged.length, 1);
    assert.equal(a.flagged[0].sessionId, s.id);
    assert.equal(a.flagged[0].concerns, 1);
    assert.equal(a.digest.sessions, 1);
    assert.equal(a.digest.flagged, 1);
    assert.equal(Number(a.digest.averageScore), 3);
    assert.ok(!first.some((x) => x.agencyName.startsWith('Agency B')), 'a team with nothing to report gets no email');

    assert.deepEqual(await svc().rpc('claim_manager_notifications', {}), [], 'nothing is sent twice');

    await u(f.A.manager).rpc('update_agency_settings', { email_notifications: false });
    await psql(f.url, `update public.agencies set digest_sent_at = now() - interval '8 days', flag_notified_at = now() - interval '1 day'`);
    assert.deepEqual(await svc().rpc('claim_manager_notifications', {}), [], 'opted out');
    await assert.rejects(u(f.A.manager).rpc('claim_manager_notifications', {}), (e: unknown) => e instanceof ApiError);
  });
});
