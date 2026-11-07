import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** `dev` (default): `next dev`, used by all mode/mock tests. `start`: the production server (needs `.next` from `next build`). */
export async function startServer(env: Record<string, string>, port: number, cmd: 'dev' | 'start' = 'dev'): Promise<{ proc: ChildProcess; url: string; logs: string[] }> {
  const logs: string[] = [];
  const isolated: Record<string, string> = {};
  if (cmd === 'dev') {
    mkdirSync(join(root, '.next-test-tsconfig'), { recursive: true });
    const tsconfig = `.next-test-tsconfig/${port}.json`;
    writeFileSync(join(root, tsconfig), JSON.stringify({ extends: '../tsconfig.json' }) + '\n');
    Object.assign(isolated, { NEXT_DIST_DIR: `.next-test-${port}`, NEXT_TSCONFIG_PATH: tsconfig });
  }
  // `next dev` via the same launcher as `npm run dev`. Each server gets its own build dir so several
  // can run side by side; the dirs are reused between runs (Turbopack's cache makes restarts fast).
  const proc = spawn(process.execPath, ['scripts/serve.ts', cmd], {
    cwd: root,
    env: { ...process.env, PORT: String(port), APP_BASE_URL: `http://127.0.0.1:${port}`, NEXT_TELEMETRY_DISABLED: '1', ...isolated, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout!.on('data', (d) => logs.push(String(d)));
  proc.stderr!.on('data', (d) => logs.push(String(d)));
  const url = `http://127.0.0.1:${port}`;
  // The first request compiles the page, so allow up to two minutes.
  for (let i = 0; i < 240; i++) {
    if (proc.exitCode !== null) break;
    try { const r = await fetch(url + '/'); if (r.ok) return { proc, url, logs }; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  proc.kill();
  throw new Error('server did not start: ' + logs.join(''));
}

export async function launch(): Promise<Browser> {
  return chromium.launch({ headless: true });
}
