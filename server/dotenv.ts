/**
 * `.env` loader for CLI scripts run directly with Node (scripts/*.ts). Next.js loads `.env` itself,
 * so this is kept out of modules the app imports (dynamic fs paths would make Next trace the whole
 * project into the server output).
 */
import { existsSync, readFileSync } from 'node:fs';

export function loadDotEnv(path = '.env') {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const [, k, raw] = m;
    if (process.env[k!] === undefined) process.env[k!] = raw!.replace(/^["']|["']$/g, '');
  }
}
