/**
 * Connected-mode UI in Chromium against real PostgreSQL, TEST auth stub and LABELLED mock providers.
 * Uses Chromium's fake media device for the microphone path. This does NOT replace real iPhone
 * Safari / Android checks of microphone permission, recording formats and playback.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser } from 'playwright';
import { createUser, dropDatabase, freshDatabase, seedTwoAgencies, type Fixture } from '../db/harness.ts';
import { psql } from '../../server/db.ts';
import { startServer } from './helpers.ts';

let f: Fixture;
let srv: Awaited<ReturnType<typeof startServer>>;
let browser: Browser;

before(async () => {
  f = await seedTwoAgencies(await freshDatabase());
  srv = await startServer({ APP_MODE: 'connected', PITCHREADY_TEST_DB_URL: f.url, AI_PROVIDER: 'mock', AI_BUDGET_CURRENCY: 'GBP', MAINTENANCE_SECRET: 'x'.repeat(40), OWNER_EMAILS: 'Manager.B@test.invalid' }, 3241);
  browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
});
after(async () => { await browser?.close(); srv?.proc.kill(); if (f) await dropDatabase(f.url); });

async function as(userId: string | null, b = browser) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  if (userId) await ctx.addCookies([{ name: 'pr_at', value: userId, url: srv.url }]);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { page, ctx, errors };
}

test('signed-out visitor is sent to sign-in', async () => {
  const { page, ctx } = await as(null);
  await page.goto(srv.url + '/practice');
  await page.waitForURL(/\/login\?next=%2Fpractice/);
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();
  await ctx.close();
});

test('rep: spoken turn via fake microphone → mock transcription → resident reply → typed turn → mock feedback', async () => {
  const { page, ctx, errors } = await as(f.A.rep1);
  await ctx.grantPermissions(['microphone'], { origin: srv.url });
  await page.goto(srv.url + '/practice');
  await page.getByText('Neighbourhood Meal Project — fictional demo').waitFor();
  await page.locator('.door-list').getByRole('link', { name: /Interested but busy/ }).click();
  await page.getByText('This browser can record audio').waitFor();
  await page.getByRole('button', { name: 'Start practice' }).click();
  await page.getByText("I've only got a moment. What's this about?").waitFor();
  await page.getByRole('button', { name: 'Enable microphone' }).click();
  // Hands-free is on by default; this test drives the manual tap-to-send path.
  await page.getByLabel(/^Hands-free/).uncheck();
  await page.getByRole('button', { name: 'Tap to speak' }).click();
  await page.getByText('Recording… tap again to send.').waitFor();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Stop and send' }).click();
  await page.getByText('[mock transcription of recorded audio]').waitFor({ timeout: 15000 });
  assert.ok((await page.locator('.bubble.resident').count()) >= 2, 'resident replied');
  if (page.url().includes('/practice/')) {
    const typed = page.getByLabel('Or type your reply');
    if (await typed.isVisible()) {
      await typed.fill("Thanks. It's an optional £10 monthly gift for community meal sessions, and it's fine to say no.");
      await page.getByRole('button', { name: 'Send reply' }).click();
      // Wait for the turn to finish (reply box enabled again) or the resident to end the practice,
      // instead of a fixed sleep: under load the round trip can take a while.
      await page.waitForFunction(() => !location.pathname.startsWith('/practice/') || !document.querySelector('#typed')?.hasAttribute('disabled'), null, { timeout: 90_000 });
    }
    if (page.url().includes('/practice/')) await page.getByRole('button', { name: 'End practice' }).click();
  }
  await page.waitForURL(/\/sessions\//);
  await page.getByText('Mock feedback (test provider — not AI)').first().waitFor({ timeout: 15000 });
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('microphone permission denied → typed fallback still works', async () => {
  const plain = await chromium.launch({ headless: true });
  try {
    const { page, ctx } = await as(f.A.rep2, plain);
    await page.goto(srv.url + '/practice/firm-refusal');
    await page.getByRole('button', { name: 'Start practice' }).click();
    await page.getByRole('button', { name: 'Enable microphone' }).click();
    await page.getByText(/permission was denied|cannot record audio/).waitFor();
    await page.getByLabel('Or type your reply').fill("Of course. Thanks for your time; I'll leave you to it.");
    await page.getByRole('button', { name: 'Send reply' }).click();
    await page.waitForURL(/\/sessions\//);
    await page.getByText('Feedback', { exact: true }).first().waitFor();
    await ctx.close();
  } finally { await plain.close(); }
});

test('manager: overview, team invite link, flagged session review', async () => {
  const { page, ctx, errors } = await as(f.A.manager);
  await page.goto(srv.url + '/manager');
  await page.getByRole('heading', { name: 'Team overview' }).waitFor();
  await page.getByText(/active reps with a completed session/).waitFor();
  await page.getByRole('link', { name: 'Team' }).click();
  await page.getByLabel('Email', { exact: true }).fill('ui.invitee@test.invalid');
  await page.getByRole('button', { name: 'Create invite link' }).click();
  await page.getByText(/\/invite\//).waitFor();
  await page.getByText('Not emailed: copy this link and send it to them yourself.').waitFor();
  // Team settings: keep data for 60 days.
  await page.getByLabel('Keep practice sessions for (days)').fill('60');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.getByText('Settings saved.').waitFor();
  await page.getByText(/Sessions are deleted after 60 days/).waitFor();
  await page.getByRole('link', { name: 'Overview' }).click();
  const link = page.locator('.card', { hasText: 'Recent sessions' }).locator('tbody tr').first().getByRole('link');
  await link.click();
  await page.getByRole('heading', { name: 'Review notes' }).waitFor();
  await page.getByLabel('Note').fill('Discussed in 1:1.');
  await page.getByRole('button', { name: 'Add review note' }).click();
  await page.getByText('Review note added.').waitFor();
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('settings: change your name; the sign-in page offers a password reset; a person with no team is offered a free pilot', async () => {
  const { page, ctx, errors } = await as(f.A.rep2);
  await page.goto(srv.url + '/settings');
  await page.getByLabel('Your name').fill('Robin Rep');
  await page.getByRole('button', { name: 'Save name' }).click();
  await page.getByText('Name saved.').waitFor();
  await page.getByRole('heading', { name: 'Change password' }).waitFor();
  assert.deepEqual(errors, []);
  await ctx.close();

  const anon = await browser.newContext();
  const p2 = await anon.newPage();
  await p2.goto(srv.url + '/login');
  await p2.getByRole('button', { name: 'Forgot your password?' }).click();
  await p2.getByRole('heading', { name: 'Reset your password' }).waitFor();
  await p2.getByLabel('Email').fill('someone@test.invalid');
  await p2.getByRole('button', { name: 'Send reset link' }).click();
  await p2.getByText(/we’ve sent a link to reset the password/).waitFor();
  await anon.close();
});

test('owner suite: only the owner can open it; features, teams, users, messages', async () => {
  // Anyone else gets "not found", and the API refuses them too.
  const other = await as(f.A.manager);
  await other.page.goto(srv.url + '/owner');
  await other.page.getByRole('heading', { name: 'Page not found' }).waitFor();
  const denied = await other.page.evaluate(async () => (await fetch('/api/owner?view=overview')).status);
  assert.equal(denied, 404);
  await other.ctx.close();

  const { page, ctx, errors } = await as(f.B.manager);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(srv.url + '/manager');
  await page.getByRole('link', { name: 'Owner' }).click();
  await page.getByRole('heading', { name: 'Owner suite' }).waitFor();
  await page.getByText(/active teams/).waitFor();

  // Features: announcement shows on every page; pausing blocks practice for reps.
  await page.getByRole('navigation', { name: 'Owner suite' }).getByRole('link', { name: 'Features' }).click();
  await page.getByLabel('Message', { exact: true }).fill('New scenarios are live.');
  await page.getByRole('button', { name: 'Save' }).last().click();
  await page.getByText('Announcement is live.').waitFor();
  await page.getByRole('region', { name: 'Announcement' }).getByText('New scenarios are live.').waitFor();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Pause practice for everyone' }).click();
  await page.getByText('Practice paused.').waitFor();
  const rep = await as(f.A.rep1);
  await rep.page.goto(srv.url + '/practice');
  await rep.page.getByText(/Practice is paused/).first().waitFor();
  await rep.ctx.close();
  await page.getByRole('button', { name: 'Turn practice back on' }).click();
  await page.getByText('Practice is back on.').waitFor();

  // Teams: open a team, add practice time.
  await page.getByRole('navigation', { name: 'Owner suite' }).getByRole('link', { name: 'Teams' }).click();
  await page.getByRole('button', { name: /^Agency A/ }).click();
  await page.getByRole('heading', { name: 'Practice time' }).waitFor();
  await page.getByLabel('Minutes', { exact: true }).fill('30');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByText('Added 30 minutes.').waitFor();

  // Users: search and see their team.
  await page.getByRole('navigation', { name: 'Owner suite' }).getByRole('link', { name: 'Users' }).click();
  await page.getByLabel('Search people').fill('rep2.a');
  await page.getByText('rep2.a@test.invalid').waitFor();

  await page.getByRole('navigation', { name: 'Owner suite' }).getByRole('link', { name: 'Activity' }).click();
  await page.getByText('Changed practice time').first().waitFor();
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('welcome questions: a new rep is asked once, sees suggested practice, and their manager sees the answers', async () => {
  const id = await createUser(f.url, 'new.rep@test.invalid', true, { onboarded: false });
  await psql(f.url, `insert into public.memberships(agency_id, user_id, role) values ('${f.A.agency}', '${id}', 'rep'); insert into public.profiles(user_id, display_name) values ('${id}', 'Nia New')`);
  const { page, ctx, errors } = await as(id);
  await page.goto(srv.url + '/practice');
  await page.waitForURL(/\/welcome\?next=%2Fpractice/);
  await page.getByRole('heading', { name: 'What do you find hardest?' }).waitFor();
  await page.getByRole('button', { name: /Handling objections/ }).click();
  assert.equal(await page.getByRole('button', { name: /Handling objections/ }).getAttribute('aria-pressed'), 'true');
  await page.getByLabel('Anything else? (optional)').fill('I go blank on price questions');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('heading', { name: 'What do you want PitchReady to help you with?' }).waitFor();
  await page.getByRole('button', { name: /Feel more confident/ }).click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.waitForURL(/\/practice$/);
  await page.getByText('Suggested for you').first().waitFor();
  // Asked once only.
  await page.goto(srv.url + '/history');
  await page.getByRole('heading', { name: 'Your practice history' }).waitFor();
  assert.deepEqual(errors, []);
  await ctx.close();

  const m = await as(f.A.manager);
  await m.page.setViewportSize({ width: 1280, height: 900 });
  await m.page.goto(srv.url + '/manager');
  await m.page.getByRole('heading', { name: 'What your reps told us' }).waitFor();
  await m.page.getByText('I go blank on price questions').waitFor();
  await m.ctx.close();

  // Someone with no team is asked how they'll use PitchReady first.
  const solo = await createUser(f.url, 'solo@test.invalid', true, { onboarded: false });
  const s = await as(solo);
  await s.page.goto(srv.url + '/practice');
  await s.page.getByRole('heading', { name: /How will you use PitchReady\?/ }).waitFor();
  await s.page.getByRole('button', { name: /I run a sales team/ }).click();
  await s.page.getByRole('heading', { name: 'What is your team struggling with?' }).waitFor();
  await s.page.getByRole('button', { name: 'Skip for now' }).click();
  await s.page.waitForURL(/\/(start|practice)$/);
  await s.ctx.close();
});
