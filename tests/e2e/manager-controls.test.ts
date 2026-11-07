/**
 * Manager controls in the demo (DECISIONS D25), in Chromium: role picker + simulated sign-in,
 * agency-written scenarios assigned per rep, say rules applied to feedback, and the rep database.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright';
import { launch, startServer } from './helpers.ts';
import { demoSignIn, demoSwitch } from './demo-helpers.ts';

let browser: Browser;
let server: Awaited<ReturnType<typeof startServer>>;

before(async () => {
  server = await startServer({ APP_MODE: 'demo' }, 3215);
  browser = await launch();
});
after(async () => { await browser?.close(); server?.proc.kill(); });

async function fresh(width = 1024): Promise<{ page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  return { page, errors };
}

async function practise(page: Page, scenarioTitle: RegExp, lines: string[]) {
  await page.locator('.door-list').getByRole('link', { name: scenarioTitle }).click();
  await page.getByRole('button', { name: 'Start practice' }).click();
  for (const line of lines) {
    if (!page.url().includes('/practice/')) break;
    await page.getByLabel('Your reply').fill(line);
    await page.getByRole('button', { name: 'Send reply' }).click();
    await page.waitForTimeout(300);
  }
  if (page.url().includes('/practice/')) await page.getByRole('button', { name: 'End practice' }).click();
  await page.waitForURL(/\/sessions\//);
  await page.getByText('Demo feedback', { exact: true }).first().waitFor();
}

test('the demo starts on the role picker; protected pages send you back to it; deactivated reps cannot sign in', async () => {
  const { page, errors } = await fresh(375);
  await page.goto(server.url + '/practice');
  await page.getByRole('heading', { name: 'Practise the doorstep before you knock.' }).waitFor();
  await page.getByRole('link', { name: 'Try it as a rep' }).first().click();
  assert.equal(await page.getByRole('radio', { name: /Dev \(demo rep\)/ }).isDisabled(), true, 'deactivated rep cannot be chosen');
  await page.getByRole('radio', { name: /Priya/ }).check();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Practise', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('manager writes a scenario and assigns only it to a rep; the rep sees and practises just that one', async () => {
  const { page, errors } = await fresh();
  await demoSignIn(page, server.url + '/', 'manager', 'Riley');
  await page.getByRole('link', { name: 'Scenarios' }).click();
  await page.getByRole('button', { name: 'New scenario' }).click();
  await page.getByLabel('Title').fill('Worried about money');
  await page.getByLabel('Resident', { exact: true }).fill('Jamie, worried about bills');
  await page.getByLabel('Opening line').fill("Money's really tight at the moment, sorry.");
  await page.getByLabel('Main objection').fill('Cost of living');
  await page.getByLabel('Rep’s goal').fill('Acknowledge the worry and end kindly without pressure.');
  await page.getByLabel('Good endings').fill('A kind, short goodbye.');
  await page.getByLabel('How the resident behaves').fill('Polite, a little anxious; ends if pushed.');
  await page.getByLabel('Skill practised').fill('Empathy');
  await page.getByRole('button', { name: 'Create scenario' }).click();
  await page.getByText('Scenario created.').waitFor();
  await page.getByRole('heading', { name: 'Worried about money' }).or(page.getByText('Worried about money', { exact: true })).first().waitFor();

  await page.getByRole('link', { name: 'Team', exact: true }).click();
  await page.getByRole('link', { name: 'Priya (demo rep)' }).click();
  await page.getByRole('radio', { name: 'Only the scenarios I choose' }).check();
  await page.getByRole('checkbox', { name: /Worried about money/ }).check();
  await page.getByRole('button', { name: 'Save scenarios' }).click();
  await page.getByText(/Saved: Priya \(demo rep\) now practises 1 scenario/).waitFor();

  await demoSwitch(page, 'rep', 'Priya');
  const titles = await page.locator('.door-list').locator('strong').allTextContents();
  assert.deepEqual(titles, ['Worried about money']);
  await practise(page, /Worried about money/, ["I completely understand, there's no pressure at all. Take care."]);
  await page.getByRole('heading', { name: 'Worried about money' }).waitFor();
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('manager adds a never-say phrase and publishes; feedback flags it and shows the must-say checklist', async () => {
  const { page, errors } = await fresh();
  await demoSignIn(page, server.url + '/', 'manager', 'Riley');
  await page.getByRole('link', { name: 'Rules & campaign' }).click();
  const never = page.getByLabel('Never-say words and phrases (one per line)');
  await never.click();
  await never.press('End');
  await never.press('Control+End');
  await never.pressSequentially('\ntrust me');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.getByText('Draft saved.').waitFor();
  await page.getByRole('button', { name: 'Publish draft' }).click();
  await page.getByText('Published version 2.').waitFor();

  await demoSwitch(page, 'rep', 'Sam');
  await page.getByText('What you must never say').click();
  await page.getByText('“trust me”').waitFor();
  await practise(page, /Interested but busy/, ["Hi, I'm Sam from the fictional Neighbourhood Meal Project. Trust me, it's worth it."]);
  await page.getByText('Must-say checklist').waitFor();
  await page.getByText('Used a never-say phrase').waitFor();
  assert.ok(await page.locator('.checklist li.said').count() >= 1, 'introduction counted as said');
  assert.deepEqual(errors, []);
  await page.context().close();
});

test('rep database: search, profile statistics, and deactivation from the profile', async () => {
  const { page, errors } = await fresh();
  await demoSignIn(page, server.url + '/', 'manager', 'Riley');
  await page.getByRole('link', { name: 'Team', exact: true }).click();
  await page.getByLabel('Search reps').fill('ais');
  const rows = page.locator('.card', { hasText: 'Rep database' }).locator('tbody tr');
  assert.equal(await rows.count(), 1);
  await rows.first().getByRole('link', { name: 'Aisha (demo rep)' }).click();
  await page.getByRole('heading', { name: 'Skills (rubric demo-1)' }).waitFor();
  await page.getByRole('heading', { name: 'Practice history' }).waitFor();
  await page.getByRole('button', { name: 'Deactivate' }).click();
  await page.getByText('Aisha (demo rep) has been deactivated.').waitFor();
  await page.getByRole('link', { name: '← Team' }).click();
  await page.getByLabel('Show').selectOption('all');
  await page.getByRole('row', { name: /Aisha/ }).getByText('Deactivated').waitFor();
  assert.deepEqual(errors, []);
  await page.context().close();
});
