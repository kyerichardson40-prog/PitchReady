import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright';
import { launch, startServer } from './helpers.ts';
import { demoSignIn, demoSwitch, menu } from './demo-helpers.ts';
import { SCENARIOS } from '../../lib/content/scenarios.ts';

let browser: Browser;
let server: Awaited<ReturnType<typeof startServer>>;

before(async () => {
  server = await startServer({ APP_MODE: 'demo' }, 3211);
  browser = await launch();
});
after(async () => { await browser?.close(); server?.proc.kill(); });

async function freshPage(width = 1024): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width, height: 800 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  (page as any).__errors = errors;
  await demoSignIn(page, server.url + '/', 'rep', 'Sam');
  return page;
}

for (const sc of SCENARIOS) {
  test(`demo: ${sc.key} → typed turns → end → evidence-linked Demo feedback → drill`, async () => {
    const page = await freshPage();
    await page.locator('.door-list').getByRole('link', { name: new RegExp(sc.title.replace(/[“”]/g, '.')) }).click();
    await page.getByRole('button', { name: 'Start practice' }).click();
    await page.getByText(sc.opener).waitFor();
    await page.getByLabel('Your reply').fill("Hi, I'm Sam from the fictional Neighbourhood Meal Project. Have you got a moment?");
    await page.getByRole('button', { name: 'Send reply' }).click();
    // Either the resident ended the conversation (navigates to feedback) or we end it.
    await page.waitForTimeout(300);
    if (page.url().includes('/practice/')) await page.getByRole('button', { name: 'End practice' }).click();
    await page.waitForURL(/\/sessions\//);
    await page.getByText('Demo feedback', { exact: true }).first().waitFor();
    assert.ok(await page.getByRole('heading', { name: 'Rubric' }).isVisible());
    // Evidence quotes link to transcript turns.
    assert.ok((await page.locator('blockquote.evidence').count()) > 0 || (await page.getByText('Not observed').count()) > 0);
    const drillBtn = page.getByRole('button', { name: /Start 60-second drill/ });
    await drillBtn.click();
    await page.getByText('Retry drill · 60s').waitFor();
    await page.getByRole('button', { name: 'Start practice' }).click();
    await page.getByLabel('Your reply').fill('I understand completely, thanks for your time.');
    await page.getByRole('button', { name: 'Send reply' }).click();
    await page.waitForTimeout(300);
    if (page.url().includes('/practice/')) await page.getByRole('button', { name: 'End practice' }).click();
    await page.waitForURL(/\/sessions\//);
    await page.getByText(/^Drill:/).first().waitFor();
    assert.deepEqual((page as any).__errors, []);
    await page.context().close();
  });
}

test('demo: firm refusal with pressure is flagged; manager sees the flag and can add a review', async () => {
  const page = await freshPage();
  await page.goto(server.url + '/practice/firm-refusal');
  await page.getByRole('button', { name: 'Start practice' }).click();
  await page.getByLabel('Your reply').fill('But surely you can spare ten pounds. Let me finish the pitch first.');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await page.waitForURL(/\/sessions\//);
  await page.getByText('Possible ignored stop request').waitFor();
  await demoSwitch(page, 'manager', 'Riley');
  await page.waitForURL(/\/manager$/);
  await page.getByRole('heading', { name: 'Flagged for review' }).waitFor();
  const flagged = page.locator('li', { hasText: 'Firm refusal' }).getByRole('link').first();
  await flagged.click();
  await page.getByLabel('Note').fill('Talked through accepting the first no.');
  await page.getByLabel('Status').selectOption('resolved');
  await page.getByRole('button', { name: 'Add review note' }).click();
  await page.getByText('Review note added.').waitFor();
  await page.context().close();
});

test('demo: report error, history, settings reset, and rep cannot open manager pages', async () => {
  const page = await freshPage();
  await menu(page, 'History');
  await page.getByRole('heading', { name: 'Your practice history' }).waitFor();
  const rows = await page.locator('tbody tr').count();
  assert.ok(rows >= 3, 'seeded history visible');
  await page.locator('tbody tr').first().getByRole('link').click();
  await page.getByRole('button', { name: /Report a transcription/ }).click();
  await page.getByLabel('Details').fill('I said "monthly", not "one-off".');
  await page.getByRole('button', { name: 'Send report' }).click();
  await page.getByText('your manager can see this report').waitFor();
  await page.goto(server.url + '/manager');
  await page.getByText('Manager access required.').waitFor();
  await page.goto(server.url + '/settings');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Reset demo data' }).first().click();
  await page.getByRole('heading', { name: 'Practise the pitch before the real one.' }).waitFor();
  assert.ok(page.url().endsWith('/'), 'reset signs out to the role picker');
  await page.context().close();
});

test('demo: pending evaluation seed can be completed; 375px layout has no horizontal scroll', async () => {
  const page = await freshPage(375);
  await page.getByRole('link', { name: /Asks about monthly giving/ }).last().click();
  await page.getByRole('heading', { name: 'Feedback pending' }).waitFor();
  await page.getByRole('button', { name: 'Run demo feedback now' }).click();
  await page.getByText('Demo feedback', { exact: true }).first().waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(overflow, false);
  // Keyboard: skip link is first focusable on a fresh load.
  await page.reload();
  await page.getByRole('heading', { name: 'Feedback', exact: true }).waitFor();
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement?.textContent);
  assert.equal(focused, 'Skip to content');
  await page.context().close();
});

test('demo: manager publishes a new campaign version; older sessions keep v1', async () => {
  const page = await freshPage();
  await demoSwitch(page, 'manager', 'Riley');
  await menu(page, 'Rules & campaign');
  await page.getByLabel('Campaign name').fill('Neighbourhood Meal Project — fictional demo (v2)');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.getByText('Draft saved.').waitFor();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Publish draft' }).click();
  await page.getByText('Published version 2.').waitFor();
  await menu(page, 'Overview');
  await page.locator('.card', { hasText: 'Recent sessions' }).locator('tbody tr').first().getByRole('link').click();
  await page.getByText(/campaign v1/).waitFor();
  await page.context().close();
});
