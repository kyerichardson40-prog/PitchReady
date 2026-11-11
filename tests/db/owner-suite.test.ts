/**
 * Owner suite (DECISIONS D39) on real PostgreSQL + migrations. Every owner function is
 * service-role only; the server passes the owner's ID as actor_id. Run: npm run test:db
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createUser, dropDatabase, freshDatabase, key, seedTwoAgencies, type Fixture } from './harness.ts';
import { psql } from '../../server/db.ts';
import { ApiError } from '../../server/http.ts';
import { bootstrapPayload } from '../../lib/content/bootstrap-payload.ts';
import { newInvitationToken } from '../../server/tokens.ts';

let f: Fixture; let owner: string;
before(async () => { f = await seedTwoAgencies(await freshDatabase()); owner = await createUser(f.url, 'owner@test.invalid'); });
after(async () => { if (f) await dropDatabase(f.url); });
const u = (id: string) => f.db.user('', id);
const svc = (fn: string, p: Record<string, unknown> = {}) => f.db.service().rpc<any>(fn, { actor_id: owner, ...p });
const one = async (sql: string) => (await psql(f.url, sql)).trim().split('\n').at(-1)!.trim();
const code = (c: string) => (e: unknown) => e instanceof ApiError && e.code === c;
const denied = (e: unknown) => e instanceof ApiError;
const payload = bootstrapPayload({ agencyName: 'x', managerEmail: 'x@x.invalid', allowanceSeconds: 600, periodDays: 30 });

describe('only the service role can run owner functions', () => {
  for (const fn of ['owner_overview', 'owner_list_teams', 'owner_list_users', 'owner_update_settings', 'owner_delete_team', 'owner_activity', 'site_settings']) {
    test(fn, async () => { await assert.rejects(u(f.A.manager).rpc(fn, {}), denied); });
  }
});

describe('site settings', () => {
  test('defaults, update, announcement and audit', async () => {
    const s = await svc('site_settings');
    assert.equal(s.pilotsEnabled, true);
    assert.equal(s.practicePaused, false);
    const n = await svc('owner_update_settings', { announcement: '  New scenarios this week  ', announcementTone: 'warn', pilotSeconds: 1800 });
    assert.equal(n.announcement, 'New scenarios this week');
    assert.equal(n.pilotSeconds, 1800);
    assert.equal(n.voiceEnabled, true, 'untouched settings keep their values');
    const cleared = await svc('owner_update_settings', { announcement: '' });
    assert.equal(cleared.announcement, null);
    assert.equal(await one(`select count(*) from public.audit_events where action = 'owner_settings_updated' and actor_id = '${owner}'`), '2');
    await assert.rejects(svc('owner_update_settings', { pilotDays: 0 }), denied);
  });

  test('pausing practice stops new sessions in the database; unpausing allows them again', async () => {
    await svc('owner_update_settings', { practicePaused: true, practicePausedMessage: 'Back at 3pm.' });
    await assert.rejects(u(f.A.rep1).rpc('start_session', { scenario_key: 'busy', request_id: key('s') }), (e: unknown) => e instanceof ApiError && e.code === 'practice_paused' && /Back at 3pm/.test(e.message));
    await svc('owner_update_settings', { practicePaused: false });
    const s: any = await u(f.A.rep1).rpc('start_session', { scenario_key: 'busy', request_id: key('s') });
    await u(f.A.rep1).rpc('end_session', { session_id: s.id });
  });
});

describe('teams', () => {
  test('overview and list show every team with its numbers', async () => {
    const o = await svc('owner_overview');
    assert.equal(o.teams, 2);
    assert.ok(o.users >= 7);
    assert.equal(o.daily.length, 14);
    const teams = await svc('owner_list_teams');
    const a = teams.find((t: any) => t.id === f.A.agency);
    assert.equal(a.managers, 1);
    assert.equal(a.reps, 2);
    assert.deepEqual(a.managerEmails, ['manager.a@test.invalid']);
    assert.equal(a.period.allowanceSeconds, 9000);
    const d = await svc('owner_team_detail', { agency_id: f.A.agency });
    assert.equal(d.members.length, 3);
    assert.ok(d.campaign.name);
  });

  test('suspending a team locks its members out and ends practice in progress; reactivating restores it', async () => {
    const s: any = await u(f.B.rep1).rpc('start_session', { scenario_key: 'busy', request_id: key('s') });
    await svc('owner_update_team', { agency_id: f.B.agency, status: 'suspended' });
    assert.equal(await one(`select status from public.sessions where id = '${s.id}'`), 'abandoned');
    await assert.rejects(u(f.B.rep1).rpc('start_session', { scenario_key: 'busy', request_id: key('s') }), denied);
    await svc('owner_update_team', { agency_id: f.B.agency, status: 'active', seatLimit: 12, renewAllowanceSeconds: 3600, renewPeriodDays: 7 });
    const t = (await svc('owner_list_teams')).find((x: any) => x.id === f.B.agency);
    assert.deepEqual([t.status, t.seatLimit, t.renewAllowanceSeconds, t.renewPeriodDays], ['active', 12, 3600, 7]);
    await svc('owner_update_team', { agency_id: f.B.agency, renewAllowanceSeconds: null });
    assert.equal((await svc('owner_team_detail', { agency_id: f.B.agency })).renewAllowanceSeconds, null, 'renewal can be switched off');
  });

  test('practice time: top up, take away (not below what is used), or start a new period', async () => {
    let t = await svc('owner_adjust_allowance', { agency_id: f.A.agency, add_seconds: 600 });
    assert.equal(t.period.allowanceSeconds, 9600);
    t = await svc('owner_adjust_allowance', { agency_id: f.A.agency, add_seconds: -1200 });
    assert.equal(t.period.allowanceSeconds, 8400);
    await assert.rejects(svc('owner_adjust_allowance', { agency_id: f.A.agency, add_seconds: -100000 }), code('invalid_input'));
    t = await svc('owner_adjust_allowance', { agency_id: f.A.agency, add_seconds: 1800, new_period: true, days: 10 });
    assert.equal(t.period.allowanceSeconds, 1800);
    assert.equal(t.period.consumedSeconds, 0);
    assert.equal(await one(`select count(*) from public.usage_periods where agency_id = '${f.A.agency}' and starts_at <= now() and ends_at > now()`), '1', 'only one current period');
  });

  test('create a team for someone with an account, or invite them; delete needs the exact name', async () => {
    const lee = await createUser(f.url, 'lee@test.invalid');
    const r1 = await svc('owner_create_team', { agency_name: 'Lee Sales', manager_email: 'LEE@test.invalid', manager_name: 'Lee', allowance_seconds: 1200, period_days: 30, payload });
    assert.equal(r1.managerAdded, true);
    const ctx: any = await u(lee).rpc('my_context');
    assert.equal(ctx.membership.role, 'manager');
    assert.equal(ctx.usage.allowanceSeconds, 1200);
    await assert.rejects(svc('owner_create_team', { agency_name: 'Again', manager_email: 'lee@test.invalid', payload }), code('already_member'));

    const { hash } = newInvitationToken();
    const r2 = await svc('owner_create_team', { agency_name: 'Future Team', manager_email: 'new.person@test.invalid', payload, token_hash_hex: hash, renew: false });
    assert.equal(r2.managerAdded, false);
    const d = await svc('owner_team_detail', { agency_id: r2.agencyId });
    assert.equal(d.invitations.length, 1);
    assert.equal(d.invitations[0].email, 'new.person@test.invalid');
    assert.equal(d.renewAllowanceSeconds, null);

    // A team with practice history can be deleted completely.
    const s: any = await u(lee).rpc('my_context');
    assert.ok(s);
    await assert.rejects(svc('owner_delete_team', { agency_id: r1.agencyId, confirm_name: 'lee sales' }), code('invalid_input'));
    await svc('owner_delete_team', { agency_id: r1.agencyId, confirm_name: 'Lee Sales' });
    assert.equal(await one(`select count(*) from public.agencies where id = '${r1.agencyId}'`), '0');
    assert.equal(await one(`select count(*) from public.audit_events where action = 'owner_team_deleted'`), '1', 'the deletion itself stays in the log');
  });

  test('deleting a team that has practice sessions removes them too', async () => {
    const before = Number(await one(`select count(*) from public.sessions where agency_id = '${f.B.agency}'`));
    assert.ok(before > 0);
    const name = await one(`select name from public.agencies where id = '${f.B.agency}'`);
    await svc('owner_delete_team', { agency_id: f.B.agency, confirm_name: name });
    assert.equal(await one(`select count(*) from public.sessions where agency_id = '${f.B.agency}'`), '0');
    assert.equal(await one(`select count(*) from public.memberships where agency_id = '${f.B.agency}'`), '0');
  });
});

describe('users', () => {
  test('list and search everyone, with their team', async () => {
    const all = await svc('owner_list_users');
    assert.ok(all.some((x: any) => x.email === 'owner@test.invalid' && x.agencyId === null));
    const found = await svc('owner_list_users', { q: 'rep1.a' });
    assert.equal(found.length, 1);
    assert.equal(found[0].role, 'rep');
  });

  test('change role, deactivate and reactivate; removal only without history', async () => {
    await svc('owner_update_member', { user_id: f.A.rep2, active: false });
    await assert.rejects(u(f.A.rep2).rpc('start_session', { scenario_key: 'busy', request_id: key('s') }), denied);
    await svc('owner_update_member', { user_id: f.A.rep2, active: true, role: 'manager' });
    assert.equal(await one(`select role || ',' || active from public.memberships where user_id = '${f.A.rep2}'`), 'manager,true');
    await svc('owner_update_member', { user_id: f.A.rep2, role: 'rep' });
    const sessions = Number(await one(`select count(*) from public.sessions where rep_id = '${f.A.rep1}'`));
    if (sessions > 0) await assert.rejects(svc('owner_update_member', { user_id: f.A.rep1, remove: true }), code('has_history'));
    const fresh = await createUser(f.url, 'fresh@test.invalid');
    await psql(f.url, `insert into public.memberships(agency_id, user_id, role) values ('${f.A.agency}', '${fresh}', 'rep')`);
    assert.equal((await svc('owner_can_delete_user', { user_id: fresh })).ok, false, 'in a team');
    await svc('owner_update_member', { user_id: fresh, remove: true });
    assert.equal((await svc('owner_can_delete_user', { user_id: fresh })).ok, true);
  });
});

describe('messages and activity', () => {
  test('contact messages can be listed and marked', async () => {
    await f.db.service().rpc('submit_contact', { name: 'Ann', email: 'ann@x.invalid', message: 'Please call me back.' });
    const open = await svc('owner_list_messages');
    assert.equal(open.length, 1);
    await svc('owner_set_message_status', { id: open[0].id, status: 'replied' });
    assert.equal((await svc('owner_list_messages')).length, 0);
    assert.equal((await svc('owner_list_messages', { status: 'all' })).length, 1);
    const log = await svc('owner_activity', { owner_only: 'true' });
    assert.ok(log.length > 0 && log.every((e: any) => e.action.startsWith('owner_')));
    assert.ok(log.some((e: any) => e.actor === 'owner@test.invalid'));
  });
});
