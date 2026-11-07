/**
 * Connected mode over HTTP: real route handlers + real PostgreSQL + migrations.
 * Auth uses the TEST stub (cookie = local auth.users id; refused in production) and providers are
 * the LABELLED MOCKS (AI_PROVIDER=mock). No Supabase, Anthropic or Deepgram service is contacted.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dropDatabase, freshDatabase, seedTwoAgencies, createUser, type Fixture } from './harness.ts';
import { startServer } from '../e2e/helpers.ts';
import { psql } from '../../server/db.ts';

const SECRET = 'test-maintenance-secret-0123456789abcdef';
let f: Fixture;
let srv: Awaited<ReturnType<typeof startServer>>;
let failSrv: Awaited<ReturnType<typeof startServer>>;

const baseEnv = (url: string) => ({ APP_MODE: 'connected', PITCHREADY_TEST_DB_URL: url, AI_PROVIDER: 'mock', AI_BUDGET_CURRENCY: 'GBP', MAINTENANCE_SECRET: SECRET });

before(async () => {
  f = await seedTwoAgencies(await freshDatabase());
  srv = await startServer(baseEnv(f.url), 3221);
  failSrv = await startServer({ ...baseEnv(f.url), MOCK_PROVIDER_FAIL: 'resident', MOCK_PROVIDER_MODE: 'uncertain' }, 3222);
});
after(async () => { srv?.proc.kill(); failSrv?.proc.kill(); if (f) await dropDatabase(f.url); });

function api(base: string, userId: string | null) {
  const call = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
    const headers: Record<string, string> = { origin: base, ...extra };
    if (userId) headers.cookie = `pr_at=${userId}`;
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + path, { method, headers, body: payload });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  };
  return { get: (p: string) => call('GET', p), post: (p: string, b?: unknown, h?: Record<string, string>) => call('POST', p, b ?? {}, h), put: (p: string, b: unknown) => call('PUT', p, b), raw: call };
}
const k = () => `key-${Math.random().toString(36).slice(2)}${Date.now()}`;

describe('connected API (mock providers)', () => {
  test('unauthenticated access is refused; /api/me reports no user', async () => {
    const anon = api(srv.url, null);
    const me = await anon.get('/api/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user, null);
    assert.equal((await anon.get('/api/sessions')).status, 401);
    assert.equal((await anon.post('/api/sessions', { scenarioKey: 'busy', idempotencyKey: k() })).status, 401);
  });

  test('CSRF: mutations without a same-origin Origin are rejected', async () => {
    const r1 = await api(srv.url, f.A.rep1).raw('POST', '/api/sessions', { scenarioKey: 'busy', idempotencyKey: k() }, { origin: 'https://evil.example' });
    assert.equal(r1.status, 403);
    assert.equal(r1.body.error.code, 'bad_origin');
    assert.ok(r1.body.error.requestId);
  });

  test('rep: start → typed turn → audio turn → end → validated, evidence-linked mock feedback', async () => {
    const rep = api(srv.url, f.A.rep1);
    const me = await rep.get('/api/me');
    assert.equal(me.body.user.role, 'rep');
    assert.equal(me.body.voice.stt, true);
    const start = await rep.post('/api/sessions', { scenarioKey: 'monthly-giving', idempotencyKey: k() });
    assert.equal(start.status, 200, JSON.stringify(start.body));
    const s = start.body.session;
    assert.equal(s.status, 'active');
    assert.ok(start.body.residentAudio?.base64, 'opener audio from mock TTS');
    const t1 = await rep.post(`/api/sessions/${s.id}/turns`, { text: "Good question. I'm Sam from the fictional Neighbourhood Meal Project; it's an optional £10 monthly gift.", expectedSequence: 2, idempotencyKey: k() });
    assert.equal(t1.status, 200, JSON.stringify(t1.body));
    assert.equal(t1.body.session.turns.length, 3);
    const fd = new FormData();
    fd.set('audio', new Blob([new TextEncoder().encode("MOCK-TRANSCRIPT:I don't have approved information on cancelling, so I'd need to check rather than guess.")], { type: 'audio/webm;codecs=opus' }), 'turn');
    fd.set('expectedSequence', '4'); fd.set('idempotencyKey', k()); fd.set('durationMs', '4000');
    const t2 = await rep.post(`/api/sessions/${s.id}/turns`, fd);
    assert.equal(t2.status, 200, JSON.stringify(t2.body));
    const repTurn = t2.body.session.turns.find((t: any) => t.id === 'rep-2');
    assert.equal(repTurn.source, 'transcribed');
    let session = t2.body.session;
    if (session.status === 'active') session = (await rep.post(`/api/sessions/${s.id}/end`, { idempotencyKey: k() })).body;
    assert.equal(session.status, 'ended');
    assert.equal(session.evaluationStatus, 'completed');
    const ev = session.evaluations.at(-1);
    assert.equal(ev.evaluatorKind, 'mock');
    assert.ok(ev.result.dimensions.length === 5);
    const got = await rep.get(`/api/sessions/${s.id}`);
    assert.equal(got.status, 200);
    // Re-requesting evaluation does not create a duplicate success.
    await rep.post(`/api/sessions/${s.id}/evaluate`);
    const n = await psql(f.url, `select count(*) from public.evaluations where session_id = '${s.id}' and status = 'completed'`);
    assert.equal(n.trim(), '1');
    // Usage was settled.
    const use = await psql(f.url, `select seconds from public.usage_ledger where session_id = '${s.id}' and kind = 'settlement'`);
    assert.ok(Number(use) >= 0);
  });

  test('stale sequence and duplicate turns via HTTP', async () => {
    const rep = api(srv.url, f.A.rep2);
    const s = (await rep.post('/api/sessions', { scenarioKey: 'existing-donor', idempotencyKey: k() })).body.session;
    const key = k();
    const a = await rep.post(`/api/sessions/${s.id}/turns`, { text: "That's great that you already give.", expectedSequence: 2, idempotencyKey: key });
    const b = await rep.post(`/api/sessions/${s.id}/turns`, { text: "That's great that you already give.", expectedSequence: 2, idempotencyKey: key });
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    assert.equal(b.body.session.turns.length, a.body.session.turns.length);
    const stale = await rep.post(`/api/sessions/${s.id}/turns`, { text: 'again', expectedSequence: 2, idempotencyKey: k() });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'stale_sequence');
    await rep.post(`/api/sessions/${s.id}/end`, { idempotencyKey: k() });
  });

  test('audio validation: unsupported MIME and oversized payloads have clear errors', async () => {
    const rep = api(srv.url, f.B.rep1);
    const s = (await rep.post('/api/sessions', { scenarioKey: 'busy', idempotencyKey: k() })).body.session;
    const bad = new FormData();
    bad.set('audio', new Blob([new Uint8Array(2000)], { type: 'video/x-matroska' }), 'x'); bad.set('expectedSequence', '2'); bad.set('idempotencyKey', k());
    const r1 = await rep.post(`/api/sessions/${s.id}/turns`, bad);
    assert.equal(r1.status, 415);
    const big = new FormData();
    big.set('audio', new Blob([new Uint8Array(10 * 1024 * 1024 + 10)], { type: 'audio/mp4' }), 'x'); big.set('expectedSequence', '2'); big.set('idempotencyKey', k());
    const r2 = await rep.post(`/api/sessions/${s.id}/turns`, big);
    assert.equal(r2.status, 413);
    await rep.post(`/api/sessions/${s.id}/end`, { idempotencyKey: k() });
  });

  test('cross-agency: manager A cannot read or review agency B sessions over HTTP', async () => {
    const repB = api(srv.url, f.B.rep2);
    const s = (await repB.post('/api/sessions', { scenarioKey: 'firm-refusal', idempotencyKey: k() })).body.session;
    const t = await repB.post(`/api/sessions/${s.id}/turns`, { text: "Of course. Thanks for your time; I'll leave you to it.", expectedSequence: 2, idempotencyKey: k() });
    assert.equal(t.body.session.status, 'ended', 'firm refusal ends after one rep turn');
    const mA = api(srv.url, f.A.manager);
    assert.equal((await mA.get(`/api/sessions/${s.id}`)).status, 404);
    assert.equal((await mA.post(`/api/manager/sessions/${s.id}/reviews`, { note: 'x', resolution: 'noted' })).status, 404);
    const list = await mA.get('/api/manager/sessions');
    assert.ok(list.body.every((x: any) => x.id !== s.id));
    const ov = await mA.get('/api/manager/overview?days=14');
    assert.equal(ov.status, 200);
    assert.equal(ov.body.activeReps, 2);
    // Rep cannot use manager endpoints.
    assert.equal((await api(srv.url, f.A.rep1).get('/api/manager/roster')).status, 403);
    assert.equal((await api(srv.url, f.A.rep1).post('/api/manager/campaign/publish')).status, 403);
  });

  test('invitations over HTTP: link shown once, checked, accepted once', async () => {
    const mA = api(srv.url, f.A.manager);
    const inv = await mA.post('/api/manager/invitations', { email: 'http.invitee@test.invalid', role: 'rep', expiresInDays: 7 });
    assert.equal(inv.status, 200, JSON.stringify(inv.body));
    const token = inv.body.link.split('/invite/')[1];
    assert.ok(token.length >= 40);
    const anonCheck = await api(srv.url, null).post('/api/invitations/check', { token });
    assert.equal(anonCheck.body.status, 'sign_in_required');
    const invitee = await createUser(f.url, 'http.invitee@test.invalid');
    const ok = await api(srv.url, invitee).post('/api/invitations/accept', { token });
    assert.equal(ok.status, 200);
    const again = await api(srv.url, invitee).post('/api/invitations/accept', { token });
    assert.equal(again.status, 410);
    const roster = await mA.get('/api/manager/roster');
    assert.ok(roster.body.members.some((m: any) => m.userId === invitee));
    const stored = await psql(f.url, `select count(*) from public.invitations where encode(token_hash, 'hex') like '%${token.slice(0, 10)}%'`);
    assert.equal(stored.trim(), '0', 'raw token is not stored');
  });

  test('manager review, correction → new revision and re-evaluation, campaign publish', async () => {
    const rep = api(srv.url, f.B.rep1);
    const s = (await rep.post('/api/sessions', { scenarioKey: 'sceptical', idempotencyKey: k() })).body.session;
    await rep.post(`/api/sessions/${s.id}/turns`, { text: "I'm Sam, with the fictional project. Our charity number is 1234567.", expectedSequence: 2, idempotencyKey: k() });
    const ended = (await rep.post(`/api/sessions/${s.id}/end`, { idempotencyKey: k() })).body;
    assert.ok(ended.evaluations.at(-1).result.concerns.some((c: any) => c.type === 'unsupported_campaign_claim'));
    const mB = api(srv.url, f.B.manager);
    const corr = await mB.post(`/api/manager/sessions/${s.id}/corrections`, { turnId: 'rep-1', correctedText: "I'm Sam, with the fictional project. I'd need to check the charity number.", idempotencyKey: k() });
    assert.equal(corr.status, 200, JSON.stringify(corr.body));
    const after2 = (await mB.get(`/api/sessions/${s.id}`)).body.session;
    assert.equal(after2.transcriptRevision, 2);
    assert.deepEqual(after2.evaluations.map((e: any) => e.transcriptRevision), [1, 2]);
    const rev = await mB.post(`/api/manager/sessions/${s.id}/reviews`, { note: 'Transcription error confirmed.', resolution: 'resolved' });
    assert.equal(rev.status, 200);
    const admin = (await mB.get('/api/manager/campaign')).body;
    const cur = admin.published.at(-1);
    const save = await mB.put('/api/manager/campaign', { pack: { ...cur.pack, name: 'Edited (fictional)' }, rubric: cur.rubric.dimensions });
    assert.equal(save.status, 200, JSON.stringify(save.body));
    const pub = await mB.post('/api/manager/campaign/publish');
    assert.equal(pub.body.version, 2);
  });

  test('provider failure (uncertain resident) stops practice, refunds allowance, keeps the cost record', async () => {
    const rep = api(failSrv.url, f.A.rep1);
    const s = (await rep.post('/api/sessions', { scenarioKey: 'busy', idempotencyKey: k() })).body.session;
    const r = await rep.post(`/api/sessions/${s.id}/turns`, { text: "Hi, I'm Sam. Have you got a moment?", expectedSequence: 2, idempotencyKey: k() });
    assert.equal(r.status, 200);
    assert.equal(r.body.session.status, 'failed');
    assert.match(r.body.notices[0], /no allowance was used/);
    const rows = await psql(f.url, `select state from public.provider_attempts where session_id = '${s.id}' and operation = 'resident'`);
    assert.equal(rows.trim(), 'uncertain');
    const refund = await psql(f.url, `select seconds from public.usage_ledger where session_id = '${s.id}' and kind = 'refund'`);
    assert.equal(Number(refund), 180);
  });

  test('maintenance endpoint rejects unknown callers and runs with the secret', async () => {
    const anon = api(srv.url, null);
    assert.equal((await anon.post('/api/maintenance', {}, { authorization: 'Bearer wrong' })).status, 401);
    assert.equal((await anon.post('/api/maintenance', {})).status, 401);
    const ok = await anon.post('/api/maintenance', {}, { authorization: `Bearer ${SECRET}` });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.ok('closed_sessions' in ok.body);
  });

  test('errors never leak raw database text', async () => {
    const r = await api(srv.url, f.A.rep1).get('/api/sessions/not-a-uuid');
    assert.equal(r.status, 404);
    assert.deepEqual(Object.keys(r.body.error).sort(), ['code', 'message', 'requestId']);
  });
});

describe('manager controls over HTTP (agency B)', () => {
  const scenario = { title: 'Worried about money', persona: 'Jamie', opener: "Money's tight, sorry.", objection: 'Cost of living', goal: 'Be kind and brief.', allowedEnding: 'A kind goodbye.', behaviour: 'Polite; ends if pushed.', skill: 'Empathy' };

  test('scenarios: create, assign to one rep, rep sees only it and practises it; archive', async () => {
    const mgr = api(srv.url, f.B.manager);
    const created = await mgr.post('/api/manager/scenarios', scenario);
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const keyB = created.body.key;
    assert.equal((await mgr.post('/api/manager/scenarios', { ...scenario, opener: '' })).status, 400, 'Zod rejects empty fields');
    assert.equal((await mgr.put(`/api/manager/members/${f.B.rep1}/scenarios`, { keys: [keyB] })).status, 200);
    const me = await api(srv.url, f.B.rep1).get('/api/me');
    assert.deepEqual(me.body.scenarios.map((x: any) => x.key), [keyB]);
    assert.deepEqual(me.body.campaign.mustSay.map((m: any) => m.id), ['M1', 'M2']);
    const rep = api(srv.url, f.B.rep1);
    const blocked = await rep.post('/api/sessions', { scenarioKey: 'busy', idempotencyKey: k() });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error.code, 'scenario_not_available');
    const st = await rep.post('/api/sessions', { scenarioKey: keyB, idempotencyKey: k() });
    assert.equal(st.status, 200, JSON.stringify(st.body));
    const id = st.body.session.id;
    const turn = await rep.post(`/api/sessions/${id}/turns`, { text: "Hi, I'm Rep from the fictional project. No pressure at all.", expectedSequence: 2, idempotencyKey: k() });
    assert.equal(turn.status, 200, JSON.stringify(turn.body));
    if (turn.body.session.status === 'active') await rep.post(`/api/sessions/${id}/end`, { idempotencyKey: k() });
    const done = await rep.get(`/api/sessions/${id}`);
    assert.equal(done.body.session.scenarioTitle, 'Worried about money');
    const ev = done.body.session.evaluations.at(-1);
    assert.equal(ev.status, 'completed', 'mock feedback for an agency-written scenario validates');
    assert.deepEqual(ev.result.required_statements.map((r: any) => r.id), ['M1', 'M2']);
    assert.equal((await mgr.put(`/api/manager/members/${f.B.rep1}/scenarios`, { keys: [] })).status, 200);
    assert.equal((await mgr.post(`/api/manager/scenarios/${keyB}/archive`, { archived: true })).status, 200);
    assert.equal((await mgr.post('/api/manager/scenarios/NOT%20A%20KEY/archive', { archived: true })).status, 404);
  });

  test('rep database: directory statistics, profile, cross-agency 404 and rep 403', async () => {
    const mgr = api(srv.url, f.B.manager);
    const roster = await mgr.get('/api/manager/roster');
    assert.equal(roster.status, 200);
    const row = roster.body.members.find((m: any) => m.userId === f.B.rep1);
    assert.ok(row.sessions >= 1 && 'meanScore' in row && Array.isArray(row.assignedKeys));
    const prof = await mgr.get(`/api/manager/members/${f.B.rep1}`);
    assert.equal(prof.status, 200);
    assert.equal(prof.body.breakdown.length, 5);
    assert.ok(prof.body.sessions.length >= 1);
    assert.equal((await mgr.get(`/api/manager/members/${f.A.rep1}`)).status, 404, 'another agency\'s rep is not found');
    assert.equal((await mgr.put(`/api/manager/members/${f.A.rep1}/scenarios`, { keys: [] })).status, 404);
    const rep = api(srv.url, f.B.rep1);
    assert.equal((await rep.get('/api/manager/scenarios')).status, 403);
    assert.equal((await rep.post('/api/manager/scenarios', scenario)).status, 403);
    assert.equal((await rep.get(`/api/manager/members/${f.B.rep2}`)).status, 403);
  });
});

describe('mode guards', () => {
  test('demo mode refuses production and non-localhost binding; connected mode without config fails closed', async () => {
    const run = (env: Record<string, string>) => new Promise<number>((resolve) => {
      const p = spawn(process.execPath, ['scripts/serve.ts', 'dev'], { env: { ...process.env, MAINTENANCE_INTERVAL_MINUTES: '0', ...env }, stdio: 'ignore' });
      const t = setTimeout(() => { p.kill(); resolve(-1); }, 10000);
      p.on('exit', (code) => { clearTimeout(t); resolve(code ?? 0); });
    });
    assert.equal(await run({ APP_MODE: 'demo', NODE_ENV: 'production', PORT: '3231' }), 1);
    assert.equal(await run({ APP_MODE: 'demo', HOST: '0.0.0.0', PORT: '3232' }), 1);
    const s = await startServer({ APP_MODE: 'connected', PITCHREADY_TEST_DB_URL: '', NEXT_PUBLIC_SUPABASE_URL: '', MAINTENANCE_SECRET: '' }, 3233);
    try {
      const r = await fetch(s.url + '/api/sessions', { headers: { origin: s.url } });
      assert.equal(r.status, 503);
      const html = await (await fetch(s.url + '/practice')).text();
      assert.match(html, /Connected mode is not configured/);
    } finally { s.proc.kill(); }
    const demo = await startServer({ APP_MODE: 'demo' }, 3234);
    try { assert.equal((await fetch(demo.url + '/api/sessions')).status, 404); } finally { demo.proc.kill(); }
  });
});
