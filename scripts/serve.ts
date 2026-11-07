/**
 * Starts Next.js (`dev` or `start`) after the mode checks the old dev server did:
 * - demo mode refuses NODE_ENV=production (also enforced in next.config.ts);
 * - demo mode binds to localhost only.
 * HOST / PORT come from the environment or .env (PORT falls back to APP_BASE_URL's port, then 3000).
 * Usage: node scripts/serve.ts dev|start
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { getConfig } from '../server/config.ts';
import { loadDotEnv } from '../server/dotenv.ts';

const cmd = process.argv[2];
if (cmd !== 'dev' && cmd !== 'start') { console.error('Usage: node scripts/serve.ts dev|start'); process.exit(2); }

loadDotEnv('.env');
const cfg = getConfig();
const production = cmd === 'start' || cfg.production;
const host = cfg.env.HOST ?? '127.0.0.1';
const port = Number(cfg.env.PORT ?? (cfg.env.APP_BASE_URL ? new URL(cfg.env.APP_BASE_URL).port : '') ?? 3000) || 3000;

if (cfg.mode === 'demo' && production) {
  console.error('Refusing to start: demo mode is not allowed with NODE_ENV=production.');
  process.exit(1);
}
if (cfg.mode === 'demo' && !['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error(`Refusing to bind demo mode to ${host}. Demo is localhost-only.`);
  process.exit(1);
}
console.log(`PitchReady (${cfg.mode} mode) → next ${cmd} on http://${host === '::1' ? '[::1]' : host}:${port}`);
if (cfg.mode === 'demo') console.log('Demo mode: synthetic data in the browser only. No accounts, no API keys, no provider calls.');
if (cfg.problems.length) console.warn('Configuration notes:\n - ' + cfg.problems.join('\n - '));

const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');
const child = spawn(process.execPath, [nextBin, cmd, '--hostname', host, '--port', String(port)], { stdio: 'inherit', env: process.env });
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => child.kill(sig));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
