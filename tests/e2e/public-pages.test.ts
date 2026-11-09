import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import { launch, startServer } from './helpers.ts';

let server: Awaited<ReturnType<typeof startServer>>;
let browser: Browser;
before(async () => {
  server = await startServer({ APP_MODE: 'demo' }, 3231);
  browser = await launch();
});
after(async () => { await browser?.close(); server?.proc.kill(); });

test('public pages open without signing in, link to each other, and fit a phone screen', async () => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const page = await ctx.newPage();
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(server.url + '/');
  await page.getByRole('heading', { name: 'Practise the pitch before the real one.' }).waitFor();
  await page.getByRole('heading', { name: 'Built for every kind of sales conversation' }).waitFor();
  await page.getByRole('link', { name: 'See the full process' }).click();
  await page.getByRole('heading', { name: 'How PitchReady works' }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/how-it-works');
  for (const [link, heading, path] of [['About us', 'About PitchReady', '/about'], ['Contact us', 'Contact us', '/contact'], ['Terms and conditions', 'Terms and conditions', '/terms'], ['Privacy', 'Privacy notice', '/privacy']] as const) {
    await page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: link }).click();
    await page.getByRole('heading', { level: 1, name: heading }).waitFor();
    assert.equal(new URL(page.url()).pathname, path);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `${path} fits 375px`);
  }
  assert.ok(await page.getByRole('link', { name: 'Sign in' }).first().isVisible(), 'Sign in stays visible in the header on phones');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('contact form checks its fields, and the demo explains it cannot send', async () => {
  const page = await browser.newPage();
  await page.goto(server.url + '/contact');
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.getByRole('alert').filter({ hasText: 'valid email address' }).waitFor();
  await page.getByLabel('Your name').fill('Alex');
  await page.getByLabel('Email').fill('alex@example.com');
  await page.getByLabel('Message').fill('We would like to try a pilot.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.getByRole('alert').filter({ hasText: 'demo can’t send messages' }).waitFor();
  await page.close();
});
