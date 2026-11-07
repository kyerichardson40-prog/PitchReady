/**
 * Database access. Every operation is an RPC into the `app_api` schema:
 *  - user(...)    → runs as the signed-in user (JWT → role `authenticated`), so RLS and auth.uid() apply.
 *  - service()    → runs as `service_role` for the few trusted server-only operations.
 * Two implementations share this interface: Supabase REST (production) and local psql (tests only).
 */
import { execFile } from 'node:child_process';
import { ApiError } from './http.ts';
import { getConfig } from './config.ts';

export interface RpcClient { rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> }
export interface Db {
  user(accessToken: string, userId: string): RpcClient;
  service(): RpcClient;
}

/** Stable code → HTTP status. Unknown database errors become a generic 500 without detail. */
const STATUS: Record<string, number> = {
  unauthenticated: 401, membership_inactive: 403, forbidden: 403, not_found: 404, invalid_input: 400, invalid_parent: 400,
  invalid_scenario: 400, scenario_not_available: 403, conflict: 409, invalid_turn: 400, invalid_pack: 400, invalid_rubric: 400, session_in_progress: 409, stale_sequence: 409,
  turn_in_progress: 409, session_closed: 409, session_active: 409, turn_limit: 409, deadline_passed: 409, allowance_exhausted: 402,
  no_usage_period: 402, no_published_campaign: 409, spend_budget_exceeded: 503, seat_limit: 409, no_draft: 409, retry_limit: 429,
  invitation_invalid: 404, invitation_revoked: 410, invitation_used: 410, invitation_expired: 410, invitation_wrong_email: 403,
  email_unconfirmed: 403, other_agency: 409, lock_mismatch: 409, immutable_record: 409, manager_not_found: 400, already_member: 409,
};

export function mapDbError(code: string | undefined, message: string | undefined, detail: string | undefined): ApiError {
  if (code === 'P0001' && message && STATUS[message]) return new ApiError(STATUS[message]!, message, detail || message);
  if (code === '42501' || /permission denied/i.test(message ?? '')) return new ApiError(403, 'forbidden', 'You do not have access to that.');
  if (code === '22P02') return new ApiError(400, 'invalid_input', 'Some fields are invalid.');
  if (code === '23514' && /consumed_seconds|reserved/.test(message ?? '')) return new ApiError(402, 'allowance_exhausted', 'Not enough practice allowance left.');
  return new ApiError(500, 'database_error', 'A database error occurred. Please try again.');
}

// ---------------------------------------------------------------- Supabase REST
export class SupabaseRestDb implements Db {
  private url: string; private publishable: string; private secret: string;
  constructor(url: string, publishable: string, secret: string) { this.url = url.replace(/\/$/, ''); this.publishable = publishable; this.secret = secret; }

  private client(headers: Record<string, string>): RpcClient {
    return {
      rpc: async <T>(fn: string, args?: Record<string, unknown>) => {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 15_000);
        let res: Response;
        try {
          res = await fetch(`${this.url}/rest/v1/rpc/${fn}`, {
            method: 'POST', signal: ctl.signal,
            headers: { ...headers, 'content-type': 'application/json', 'content-profile': 'app_api', 'accept-profile': 'app_api' },
            body: JSON.stringify(args === undefined ? {} : { p: args }),
          });
        } catch {
          throw new ApiError(503, 'database_unavailable', 'The database is not reachable right now.');
        } finally { clearTimeout(t); }
        const text = await res.text();
        const body = text ? JSON.parse(text) : null;
        if (!res.ok) throw mapDbError(body?.code, body?.message, body?.details);
        return body as T;
      },
    };
  }
  user(accessToken: string): RpcClient {
    return this.client({ apikey: this.publishable, authorization: `Bearer ${accessToken}` });
  }
  service(): RpcClient {
    // New-style Supabase secret keys go in `apikey`; they authorise as service_role when no user JWT is sent.
    return this.client({ apikey: this.secret, ...(this.secret.startsWith('eyJ') ? { authorization: `Bearer ${this.secret}` } : {}) });
  }
}

// ---------------------------------------------------------------- local psql (tests only)
function sqlLiteral(s: string) { return `'${s.replace(/'/g, "''")}'`; }

export function psql(url: string, sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('psql', [url, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-At', '-c', sql], { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(new Error(stderr || err.message), { stderr })); else resolve(stdout);
    });
  });
}

export function parsePgError(stderr: string): { code?: string; message?: string; detail?: string } {
  const m = stderr.match(/ERROR:\s+(.+)/);
  const d = stderr.match(/DETAIL:\s+(.+)/);
  const message = m?.[1]?.trim();
  if (message && /^[a-z_]+$/.test(message)) return { code: 'P0001', message, detail: d?.[1]?.trim() };
  if (message && /permission denied/.test(message)) return { code: '42501', message };
  if (message && /violates check constraint/.test(message)) return { code: '23514', message };
  if (message && /invalid input syntax/.test(message)) return { code: '22P02', message };
  return { message };
}

export class PsqlDb implements Db {
  private url: string;
  constructor(url: string) {
    if (getConfig().production) throw new Error('PsqlDb is test-only.');
    this.url = url;
  }
  private async call<T>(role: string, claims: Record<string, unknown> | null, fn: string, args?: Record<string, unknown>): Promise<T> {
    const callExpr = args === undefined ? `app_api.${fn}()` : `app_api.${fn}(${sqlLiteral(JSON.stringify(args))}::jsonb)`;
    const sql = `begin; set local role ${role}; select set_config('request.jwt.claims', ${sqlLiteral(JSON.stringify(claims ?? {}))}, true);
      select coalesce(${callExpr}::text, 'null'); commit;`;
    try {
      const out = await psql(this.url, sql);
      const line = out.trim().split('\n').filter(Boolean).at(-1) ?? 'null';
      return JSON.parse(line) as T;
    } catch (e: any) {
      const pe = parsePgError(e.stderr ?? String(e));
      if (process.env.PITCHREADY_DEBUG_DB) console.error('[psql]', fn, (e.stderr ?? String(e)).slice(0, 500));
      throw mapDbError(pe.code, pe.message, pe.detail);
    }
  }
  user(_token: string, userId: string): RpcClient {
    return { rpc: (fn, args) => this.call('authenticated', { sub: userId, role: 'authenticated' }, fn, args) };
  }
  service(): RpcClient {
    return { rpc: (fn, args) => this.call('service_role', { role: 'service_role' }, fn, args) };
  }
}

let instance: Db | null = null;
export function getDb(): Db {
  if (instance) return instance;
  const { env } = getConfig();
  if (env.PITCHREADY_TEST_DB_URL) instance = new PsqlDb(env.PITCHREADY_TEST_DB_URL);
  else instance = new SupabaseRestDb(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, env.SUPABASE_SECRET_KEY!);
  return instance;
}
export function setDbForTests(db: Db | null) { instance = db; }
