/**
 * One-time local setup check (any OS):  npm run setup:local
 *  - checks the Node.js version;
 *  - fills MAINTENANCE_SECRET in .env with a random value if it is empty;
 *  - checks the keys you must paste are present and look like the right kind of key.
 * It never prints a key.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const problems: string[] = [];
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj! < 22 || (maj === 22 && min! < 18)) problems.push(`Node.js ${process.versions.node} is too old. Install the LTS version from nodejs.org (22.18 or newer), then open a new window.`);

if (!existsSync('.env')) {
  console.error('No .env file in this folder. Run this from the PitchReady folder (the one containing package.json).');
  process.exit(1);
}
let text = readFileSync('.env', 'utf8').replace(/^﻿/, '');
const get = (k: string) => text.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '';

if (get('MAINTENANCE_SECRET').length < 32) {
  const secret = randomBytes(32).toString('hex');
  text = /^MAINTENANCE_SECRET=.*$/m.test(text) ? text.replace(/^MAINTENANCE_SECRET=.*$/m, `MAINTENANCE_SECRET=${secret}`) : `${text.trimEnd()}\nMAINTENANCE_SECRET=${secret}\n`;
  writeFileSync('.env', text);
  console.log('✓ Created a maintenance secret in .env');
}

const checks: [string, (v: string) => boolean, string][] = [
  ['SUPABASE_SECRET_KEY', (v) => v.startsWith('sb_secret_') || v.split('.').length === 3, 'Supabase dashboard → Project Settings → API Keys → Secret keys (starts sb_secret_)'],
  ['ANTHROPIC_API_KEY', (v) => v.startsWith('sk-ant-'), 'console.anthropic.com → API Keys (starts sk-ant-)'],
  ['DEEPGRAM_API_KEY', (v) => /^[A-Za-z0-9_-]{20,}$/.test(v), 'console.deepgram.com → API Keys'],
];
for (const [key, ok, where] of checks) {
  const v = get(key);
  if (!v) problems.push(`${key} is empty. Paste it into .env: ${where}`);
  else if (!ok(v)) problems.push(`${key} doesn't look right (check you copied the whole key, with no spaces). Get it from: ${where}`);
  else console.log(`✓ ${key} is filled in`);
}
if (!existsSync(get('PROVIDER_RATE_CARD_PATH') || 'config/rate-card.json')) problems.push('config/rate-card.json is missing.');

if (problems.length) {
  console.error('\nFix these, save .env, then run "npm run setup:local" again:\n' + problems.map((p) => `  • ${p}`).join('\n'));
  process.exit(1);
}
console.log('\nAll set. Next: npm run build   then   npm start');
