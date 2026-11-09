import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeProgress, sessionScore } from '../../lib/domain/progress.ts';
import { computeTrend } from '../../lib/domain/metrics.ts';
import { SilenceDetector } from '../../src/client/voice/recorder.ts';
import { invitationEmail, managerEmail, sendEmail } from '../../server/services/notify.ts';
import { isRecoverySession } from '../../server/auth.ts';

const NOW = new Date(2026, 10, 9, 18, 0, 0);
const daysAgo = (d: number, h = 12) => new Date(2026, 10, 9 - d, h, 0, 0).toISOString();
const sess = (id: string, endedAt: string, scores: (number | null)[] | null): any => ({
  id, status: 'ended', endedAt, scenarioKey: 'busy', scenarioTitle: `Scenario ${id}`, turns: [], corrections: [],
  evaluations: scores ? [{ id: `e${id}`, transcriptRevision: 1, status: 'completed', createdAt: endedAt,
    result: { dimensions: ['introduction', 'accuracy', 'listening', 'next_step', 'respect'].map((key, i) => ({ key, score: scores[i] ?? null })) } }] : [],
});

test('session score: mean of observed scores only', () => {
  assert.equal(sessionScore(sess('a', daysAgo(0), [4, 4, null, 2, null])), 3.3);
  assert.equal(sessionScore(sess('b', daysAgo(0), null)), null);
  assert.equal(sessionScore(sess('c', daysAgo(0), [null, null, null, null, null])), null);
});

test('rep progress: recent average vs the five before, streak, best, skills', () => {
  const all = [
    ...[9, 8, 7, 6, 5].map((d, i) => sess(`old${i}`, daysAgo(d + 3), [2, 2, 2, 2, 2])),
    sess('n1', daysAgo(3), [3, 3, 3, 3, 3]), sess('n2', daysAgo(2), [3, 3, 3, 3, 3]),
    sess('n3', daysAgo(1), [4, 4, 4, 4, 4]), sess('n4', daysAgo(0), [5, 5, 5, 5, 5]), sess('n5', daysAgo(0, 14), [4, 4, 4, 4, null]),
    sess('pending', daysAgo(0, 15), null),
    { ...sess('active', daysAgo(0), null), status: 'active' },
  ];
  const p = computeProgress(all, NOW);
  assert.equal(p.sessions, 11);
  assert.equal(p.scored, 10);
  assert.equal(p.average, 3.8);
  assert.equal(p.previousAverage, 2);
  assert.equal(p.best!.id, 'n4');
  assert.equal(p.practisedToday, true);
  assert.equal(p.streakDays, 4, 'today and the three days before');
  assert.equal(p.skills.find((k) => k.key === 'respect')!.average, 3.8, 'not-observed scores are left out');
  assert.equal(p.recent.length, 10);
  assert.equal(p.recent.at(-1)!.id, 'n5');
});

test('rep progress: a streak survives until the end of the next day; nothing scored means no averages', () => {
  const p = computeProgress([sess('y', daysAgo(1), [3, 3, 3, 3, 3]), sess('z', daysAgo(2), [3, 3, 3, 3, 3])], NOW);
  assert.equal(p.practisedToday, false);
  assert.equal(p.streakDays, 2);
  assert.equal(p.previousAverage, null);
  assert.equal(computeProgress([sess('q', daysAgo(3), [3, 3, 3, 3, 3])], NOW).streakDays, 0);
  assert.equal(computeProgress([], NOW).average, null);
});

test('manager trend: four 7-day windows, averages only with enough sessions', () => {
  const mk = (id: string, repId: string, d: number, score: number) => ({ id, repId, endedAt: daysAgo(d), evaluationStatus: 'completed', rubricVersion: 'v1',
    scores: { introduction: score, accuracy: score, listening: null }, usedSeconds: 100, openConcerns: 0, openReports: 0 }) as any;
  const t = computeTrend({ now: NOW, currentRubricVersion: 'v1', activeRepIds: ['r1', 'r2'],
    sessions: [mk('a', 'r1', 1, 4), mk('b', 'r2', 2, 4), mk('c', 'r1', 3, 5), mk('d', 'r1', 9, 2), mk('e', 'gone', 1, 1), mk('f', 'r2', 25, 3)] });
  assert.deepEqual(t.map((w) => w.weeksAgo), [3, 2, 1, 0]);
  assert.deepEqual(t.map((w) => w.sessions), [1, 0, 1, 3]);
  assert.equal(t[3]!.reps, 2);
  assert.equal(t[3]!.mean, 4.3);
  assert.equal(t[2]!.mean, null, 'one session is too few to average');
});

test('hands-free: sends after speech then quiet; never on silence alone; ignores short blips', () => {
  const run = (levels: [number, number][]) => { // [level, durationMs]
    const d = new SilenceDetector(); let t = 0; let fired: number | null = null;
    for (const [level, ms] of levels) for (let i = 0; i < ms / 50; i++) { t += 50; if (d.feed(level, t) && fired === null) fired = t; }
    return { fired, heard: d.heardSpeech };
  };
  const speech = run([[0.005, 300], [0.2, 1500], [0.005, 2000]]);
  assert.ok(speech.heard);
  assert.ok(speech.fired !== null && speech.fired >= 300 + 1500 + 1400 && speech.fired <= 300 + 1500 + 1600, `fired at ${speech.fired}`);
  assert.deepEqual(run([[0.005, 5000]]), { fired: null, heard: false });
  assert.equal(run([[0.005, 300], [0.2, 100], [0.005, 4000]]).fired, null, 'a cough is not a reply');
  const pause = run([[0.005, 300], [0.2, 800], [0.005, 900], [0.2, 800], [0.005, 1600]]);
  assert.ok(pause.fired !== null && pause.fired > 300 + 800 + 900 + 800, 'a short thinking pause does not send');
  assert.ok(run([[0.05, 300], [0.3, 1000], [0.05, 2000]]).fired !== null, 'works in a noisy room');
});

test('emails: invitation and manager emails are plain text and keep to one line where it matters', () => {
  const inv = invitationEmail({ agencyName: 'Acme\nSales', inviterName: 'Kye', role: 'rep', link: 'https://x.example/invite/abc', expiresAt: '2026-11-16T10:00:00Z' });
  assert.equal(inv.subject, "You're invited to join Acme Sales on PitchReady");
  assert.match(inv.text, /https:\/\/x\.example\/invite\/abc/);
  assert.match(inv.text, /16 November 2026/);
  const m = managerEmail({ agencyName: 'Acme', managers: ['m@x.example'], flagged: [{ sessionId: 's1', repName: 'Sam', scenarioTitle: 'Busy parent', concerns: 2 }],
    digest: { sessions: 12, reps: 3, activeReps: 4, averageScore: 3.6, flagged: 1 } }, 'https://x.example');
  assert.equal(m.subject, 'PitchReady weekly summary: 12 sessions');
  assert.match(m.text, /3 of 4 reps practised/);
  assert.match(m.text, /Sam · Busy parent \(2 concerns\)\n {2}https:\/\/x\.example\/manager\/sessions\/s1/);
  const alert = managerEmail({ agencyName: 'Acme', managers: [], flagged: [{ sessionId: 's1', repName: 'Sam', scenarioTitle: 'T', concerns: 1 }], digest: null }, 'https://x.example');
  assert.equal(alert.subject, 'PitchReady: 1 session flagged for review');
});

test('emails: nothing is sent without a key or recipients; failures never throw', async () => {
  const noFetch = (async () => { throw new Error('should not be called'); }) as typeof fetch;
  assert.equal(await sendEmail({ to: ['a@x.example'], subject: 's', text: 't', tag: 'test' }, { env: {}, fetchImpl: noFetch }), 'skipped');
  assert.equal(await sendEmail({ to: [], subject: 's', text: 't', tag: 'test' }, { env: { RESEND_API_KEY: 're_x' }, fetchImpl: noFetch }), 'skipped');
  let body: any;
  const ok = (async (_u: string, init: RequestInit) => { body = JSON.parse(String(init.body)); return new Response('{}'); }) as unknown as typeof fetch;
  assert.equal(await sendEmail({ to: ['a@x.example'], subject: 'Hi\nthere', text: 't', tag: 'test' }, { env: { RESEND_API_KEY: 're_x' }, fetchImpl: ok }), 'sent');
  assert.equal(body.subject, 'Hi there');
  assert.equal(body.reply_to, undefined);
});

test('password reset: only a recent recovery sign-in may skip the current password', () => {
  const token = (amr: unknown) => `x.${Buffer.from(JSON.stringify({ amr })).toString('base64url')}.y`;
  const now = 1_800_000_000_000;
  assert.equal(isRecoverySession(token([{ method: 'recovery', timestamp: now / 1000 - 60 }]), now), true);
  assert.equal(isRecoverySession(token([{ method: 'recovery', timestamp: now / 1000 - 3600 }]), now), false);
  assert.equal(isRecoverySession(token([{ method: 'password', timestamp: now / 1000 - 60 }]), now), false);
  assert.equal(isRecoverySession('not-a-token', now), false);
});
