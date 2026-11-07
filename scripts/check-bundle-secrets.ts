/**
 * Runs a production `next build` (connected mode) and fails if anything server-only leaks into the
 * browser output (.next/static): secret env names, provider endpoints, service-role code, test
 * hooks, Node built-ins, or the actual values of any secret present in the environment / .env.
 * Pass --skip-build to scan an existing build.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadDotEnv } from '../server/dotenv.ts';

loadDotEnv();
const distDir = '.next';
if (!process.argv.includes('--skip-build')) {
  const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');
  execFileSync(process.execPath, [nextBin, 'build'], {
    env: { ...process.env, NODE_ENV: 'production', APP_MODE: 'connected', NEXT_DIST_DIR: distDir, NEXT_TELEMETRY_DISABLED: '1' },
    stdio: 'inherit',
  });
}

const staticDir = join(distDir, 'static');
if (!existsSync(staticDir)) { console.error(`No client output at ${staticDir}. Run without --skip-build.`); process.exit(1); }
const files: string[] = [];
const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(js|css|json)$/.test(n)) files.push(p); } };
walk(staticDir);

const forbidden = [
  'SUPABASE_SECRET_KEY', 'ANTHROPIC_API_KEY', 'DEEPGRAM_API_KEY', 'MAINTENANCE_SECRET', 'PITCHREADY_TEST_DB_URL',
  'api.anthropic.com', 'api.deepgram.com', 'service_role', 'commit_resident_turn', 'save_evaluation', 'bootstrap_agency',
  'RESIDENT_SYSTEM_PROMPT', 'You provide bounded coaching feedback', 'node:child_process', 'node:crypto',
];
const secretValues = ['SUPABASE_SECRET_KEY', 'ANTHROPIC_API_KEY', 'DEEPGRAM_API_KEY', 'MAINTENANCE_SECRET']
  .map((k) => process.env[k]).filter((v): v is string => !!v && v.length >= 8);

let bytes = 0;
const hits: string[] = [];
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  bytes += text.length;
  for (const s of forbidden) if (text.includes(s)) hits.push(`${s} in ${f}`);
  for (const v of secretValues) if (text.includes(v)) hits.push(`<secret value> in ${f}`);
}
if (hits.length) { console.error('Client bundle contains server-only material:\n - ' + hits.join('\n - ')); process.exit(1); }
console.log(`Bundle check passed (${files.length} files, ${(bytes / 1024).toFixed(0)} KiB scanned, ${forbidden.length} markers + ${secretValues.length} secret values).`);
