/** Practice tasks (D44) in the demo: manager sets one, the rep sees it, practises, gets the tick. */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import { launch, startServer } from './helpers.ts';
import { demoSignIn, demoSwitch, menu } from './demo-helpers.ts';

let browser: Browser;
let server: Awaited<ReturnType<typeof startServer>>;
before(async () => { server = await startServer({ APP_MODE: 'demo' }, 3215); browser = await launch(); });
after(async () => { await browser?.close(); server?.proc.kill(); });

test('demo: manager sets "practise X once" for Sam; Sam sees it, practises, and it shows done for both', async () => {
  const page = await (await browser.newContext({ viewport: { width: 1024, height: 900 } })).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await demoSignIn(page, server.url + '/', 'manager', 'Riley');
  await menu(page, 'Practice tasks');
  await page.getByRole('heading', { name: 'Practice tasks', exact: true }).waitFor();
  await page.getByText(/× 2/).first().waitFor(); // the seeded example task
  await page.getByRole('button', { name: 'New task' }).click();
  await page.getByLabel('Scenario').selectOption({ label: 'Busy resident' }).catch(async () => {
    await page.getByLabel('Scenario').selectOption({ index: 0 });
  });
  const scenario = await page.getByLabel('Scenario').evaluate((el: HTMLSelectElement) => el.selectedOptions[0]!.text);
  await page.getByLabel('How many times').fill('1');
  await page.getByLabel('Choose reps').check();
  await page.getByRole('group', { name: 'Reps' }).getByLabel(/Sam/).check();
  await page.getByLabel('Note for your reps (optional)').fill('Warm-up before Saturday.');
  await page.getByRole('button', { name: 'Set task' }).click();
  await page.getByText(/^Task set:/).waitFor();
  await page.getByRole('heading', { name: `${scenario} × 1` }).waitFor();

  await demoSwitch(page, 'rep', 'Sam');
  const inbox = page.locator('.task-inbox');
  await inbox.getByText(`Practise “${scenario}” 1 time`).waitFor();
  await inbox.getByText('“Warm-up before Saturday.”').waitFor();
  const row = inbox.locator('li', { hasText: `Practise “${scenario}” 1 time` });
  await row.getByRole('link', { name: 'Practise now' }).click();
  await page.getByRole('button', { name: 'Start practice' }).click();
  await page.getByLabel('Your reply').fill("Hi, I'm Sam from the fictional Neighbourhood Meal Project. Have you got a moment?");
  await page.getByRole('button', { name: 'Send reply' }).click();
  await page.waitForTimeout(300);
  if (page.url().includes('/practice/')) await page.getByRole('button', { name: 'End practice' }).click();
  await page.waitForURL(/\/sessions\//);
  await menu(page, 'Practise');
  await inbox.locator('li.is-done', { hasText: `Practise “${scenario}” 1 time` }).getByText(/Done, nice work/).waitFor();

  await demoSwitch(page, 'manager', 'Riley');
  await menu(page, 'Practice tasks');
  const card = page.locator('.task-card', { hasText: `${scenario} × 1` });
  await card.getByText('1 of 1 done').first().waitFor();
  await card.getByRole('button', { name: /^Archive/ }).click();
  await page.getByText(/archived\. Reps won’t see it/).waitFor();
  assert.equal(await page.locator('.task-card', { hasText: `${scenario} × 1` }).count(), 0);
  assert.deepEqual(errors, []);
});
