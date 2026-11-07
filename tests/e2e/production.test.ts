/**
 * The production Next.js server (`next build` + `next start`), which the other suites cannot use
 * because demo mode, mock providers and the test DB are refused in production.
 * Checks: strict nonce CSP with no violations in Chromium, security headers, connected mode without
 * configuration fails closed, unknown routes 404, and demo mode refuses to start.
 * Builds `.next` first if no build exists (CI builds it in `npm run check:bundle`).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser } from 'playwright';
import { launch, startServer } from './helpers.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const env = { APP_MODE: 'connected', NEXT_PUBLIC_SUPABASE_URL: '', PITCHREADY_TEST_DB_URL: '', MAINTENANCE_SECRET: '' };
let srv: Awaited<ReturnType<typeof startServer>>;
let browser: Browser;

before(async () => {
  if (!existsSync(join(root, '.next', 'BUILD_ID'))) {
    const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');
    execFileSync(process.execPath, [nextBin, 'build'], { cwd: root, env: { ...process.env, APP_MODE: 'connected', NEXT_DIST_DIR: '.next', NEXT_TELEMETRY_DISABLED: '1' }, stdio: 'ignore' });
  }
  srv = await startServer(env, 3261, 'start');
  browser = await launch();
});
after(async () => { await browser?.close(); srv?.proc.kill(); });

test('production: nonce CSP and security headers on pages; strict CSP on API', async () => {
  const page = await fetch(srv.url + '/practice');
  const csp = page.headers.get('content-security-policy') ?? '';
  assert.match(csp, /script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  assert.doesNotMatch(csp, /unsafe-eval|unsafe-inline/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('x-powered-by'), null);
  const nonce = csp.match(/'nonce-([^']+)'/)![1]!;
  const html = await page.text();
  assert.ok(html.includes(`nonce="${nonce}"`), 'Next scripts carry the request nonce');
  const again = await fetch(srv.url + '/practice');
  assert.notEqual(again.headers.get('content-security-policy'), csp, 'nonce is per request');
  const api = await fetch(srv.url + '/api/me');
  assert.equal(api.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'");
});

test('production: unconfigured connected mode fails closed; browser shows setup guidance with no CSP violations', async () => {
  assert.equal((await fetch(srv.url + '/api/sessions', { headers: { origin: srv.url } })).status, 503);
  const p = await browser.newPage();
  const problems: string[] = [];
  p.on('console', (m) => { if (/Content Security Policy/.test(m.text())) problems.push(m.text()); });
  p.on('pageerror', (e) => problems.push(e.message));
  for (const path of ['/practice', '/login', '/manager']) {
    await p.goto(srv.url + path);
    await p.getByText('Connected mode is not configured', { exact: false }).waitFor();
  }
  assert.deepEqual(problems, []);
  await p.close();
});

test('production: unknown routes return 404', async () => {
  assert.equal((await fetch(srv.url + '/no-such-page')).status, 404);
  assert.equal((await fetch(srv.url + '/api/no-such-route')).status, 404);
});

test('production: demo mode refuses to start', async () => {
  const code = await new Promise<number>((resolve) => {
    const p = spawn(process.execPath, ['scripts/serve.ts', 'start'], { cwd: root, env: { ...process.env, APP_MODE: 'demo', PORT: '3262' }, stdio: 'ignore' });
    const t = setTimeout(() => { p.kill(); resolve(-1); }, 15000);
    p.on('exit', (c) => { clearTimeout(t); resolve(c ?? 0); });
  });
  assert.equal(code, 1);
});
