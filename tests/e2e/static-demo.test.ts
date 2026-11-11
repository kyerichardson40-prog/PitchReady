/**
 * The standalone demo file (dist/pitchready-demo.html) in Chromium, opened from disk with no server.
 * Covers the interview walk-through: the "I already give to charity" scenario → evidence-linked
 * Demo feedback → 60-second drill, the firm-refusal flag in the manager view, and reset.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Browser, Page } from 'playwright';
import { launch } from './helpers.ts';
import { fakeClaudeScript } from './fake-claude.ts';
import { demoSignIn, demoSwitch, menu } from './demo-helpers.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const file = pathToFileURL(join(root, 'dist/pitchready-demo.html')).href;
let browser: Browser;

before(async () => {
  execFileSync(process.execPath, ['scripts/build-static-demo.ts'], { cwd: root, stdio: 'ignore' });
  browser = await launch();
});
after(async () => { await browser?.close(); });

async function open(width = 1024, claude?: 'ok' | 'deny'): Promise<{ page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width, height: 800 } });
  if (claude) await ctx.addInitScript({ content: fakeClaudeScript(claude) });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await demoSignIn(page, file, 'rep', 'Sam');
  return { page, errors };
}

const send = async (page: Page, text: string) => {
  await page.getByLabel('Your reply').fill(text);
  await page.getByRole('button', { name: 'Send reply' }).click();
};

test('static demo: existing-donor scenario → Demo feedback → drill, at 375px', async () => {
  const { page, errors } = await open(375);
  await page.locator('.door-list').getByRole('link', { name: /I already give to charity/ }).click();
  await page.getByRole('button', { name: 'Start practice' }).click();
  await send(page, "Hi, I'm Sam from the fictional Neighbourhood Meal Project. Have you got a moment?");
  await page.waitForTimeout(300);
  const end = page.getByRole('button', { name: 'End practice' });
  if (await end.isVisible()) await end.click();
  await page.getByText('Demo feedback', { exact: true }).first().waitFor();
  assert.ok(await page.getByRole('heading', { name: 'Rubric' }).isVisible());
  // Opened outside claude.ai: the banner says why Live AI is off instead of silently hiding it.
  assert.ok(await page.getByText(/Live AI is off: this view can’t reach Claude/).isVisible());
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
  await page.getByRole('button', { name: /Start 60-second drill/ }).click();
  await page.getByText('Retry drill · 60s').waitFor();
  await page.getByRole('button', { name: 'Start practice' }).click();
  await send(page, 'That’s great that you already give. Thanks for your time.');
  await page.waitForTimeout(300);
  if (await end.isVisible()) await end.click();
  await page.getByText(/^Drill:/).first().waitFor();
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('static demo: firm refusal is flagged for the manager; reset restores the seed', async () => {
  const { page, errors } = await open();
  await page.locator('.door-list').getByRole('link', { name: /Firm refusal/ }).click();
  await page.getByRole('button', { name: 'Start practice' }).click();
  await send(page, 'But surely you can spare ten pounds. Let me finish the pitch first.');
  await page.getByText('Possible ignored stop request').waitFor();
  await demoSwitch(page, 'manager', 'Riley');
  await page.getByRole('heading', { name: 'Team overview' }).waitFor();
  await page.getByRole('heading', { name: 'Needs your attention' }).waitFor();
  await page.getByRole('button', { name: 'Reset demo data' }).first().click();
  await page.getByRole('heading', { name: 'Practise the pitch before the real one.' }).waitFor();
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('static demo, live AI (stubbed claude.ai): Claude replies as the resident; feedback is written in the background and labelled AI', async () => {
  const { page, errors } = await open(390, 'ok');
  await page.getByText('Live AI is on').waitFor();
  assert.ok(await page.getByLabel('Live AI').isChecked());
  await page.locator('.door-list').getByRole('link', { name: /I already give to charity/ }).click();
  await page.getByRole('button', { name: 'Start practice' }).click();
  await page.getByText('(Claude, live)').waitFor();
  await send(page, "Hi, I'm Sam from the fictional Neighbourhood Meal Project. Have you got a moment?");
  await page.getByText('Live AI resident: go on, but be quick.').waitFor();
  await page.getByRole('button', { name: 'End practice' }).click();
  await page.getByRole('heading', { name: 'Claude is writing your feedback…' }).waitFor();
  await page.getByText(/AI feedback · Claude via claude\.ai/).first().waitFor();
  await page.getByText('Live AI strength: a friendly, clear opening.').waitFor();
  const calls = await page.evaluate(() => (window as any).__claudeCalls as { tier: string }[]);
  assert.deepEqual(calls.map((c) => c.tier), ['quick', 'default']);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('static demo, live AI refused: scripted resident with a notice, Live AI switches off, rule-based feedback', async () => {
  const { page, errors } = await open(1024, 'deny');
  await page.locator('.door-list').getByRole('link', { name: /Interested but busy/ }).click();
  await page.getByRole('button', { name: 'Start practice' }).click();
  await send(page, "Hi, I'm Sam from the fictional Neighbourhood Meal Project.");
  await page.getByText(/this resident line is scripted/).waitFor();
  const end = page.getByRole('button', { name: 'End practice' });
  if (await end.isVisible()) await end.click();
  await page.getByText('Demo feedback', { exact: true }).first().waitFor();
  assert.equal(await page.getByLabel('Live AI').isChecked(), false);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('static demo: Back steps through screens (Android back button in the app shell)', async () => {
  const { page, errors } = await open();
  await menu(page, 'History');
  await page.getByRole('heading', { name: 'Your practice history' }).waitFor();
  await menu(page, 'Settings');
  await page.goBack();
  await page.getByRole('heading', { name: 'Your practice history' }).waitFor();
  await page.goBack();
  await page.getByRole('heading', { name: 'Practise', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('static demo inside the app shell (simulated Capacitor): explains that Live AI is not in the app', async () => {
  const ctx = await browser.newContext();
  await ctx.addInitScript({ content: 'window.Capacitor = { isNativePlatform: () => true };' + fakeClaudeScript('ok') });
  const page = await ctx.newPage();
  await page.goto(file);
  await page.getByText(/Live AI isn’t available in the app’s built-in demo/).waitFor();
  assert.equal(await page.getByLabel('Live AI').count(), 0, 'no Live AI switch in the app');
  await ctx.close();
});
