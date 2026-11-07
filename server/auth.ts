/**
 * Supabase Auth over its REST API (GoTrue). Tokens live in httpOnly cookies set by our own routes;
 * the browser never sees the Supabase secret key. Every request re-verifies the access token with
 * Supabase (`GET /auth/v1/user`) rather than trusting cookie contents.
 * In tests (PITCHREADY_TEST_DB_URL, never production) a stub resolves users from the local auth.users table.
 */
import { getConfig } from './config.ts';
import { ApiError } from './http.ts';
import { psql } from './db.ts';

export interface AuthUser { id: string; email: string; accessToken: string; emailConfirmed: boolean }
export interface AuthResult { user: AuthUser | null; setCookies: string[] }

const AT = 'pr_at';
const RT = 'pr_rt';

function cookieAttrs(maxAge: number): string {
  const secure = getConfig().env.APP_BASE_URL.startsWith('https://') ? '; Secure' : '';
  return `; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
export function sessionCookies(accessToken: string, refreshToken: string): string[] {
  return [`${AT}=${encodeURIComponent(accessToken)}${cookieAttrs(60 * 60 * 24 * 7)}`, `${RT}=${encodeURIComponent(refreshToken)}${cookieAttrs(60 * 60 * 24 * 30)}`];
}
export function clearCookies(): string[] {
  return [`${AT}=${cookieAttrs(0)}`, `${RT}=${cookieAttrs(0)}`];
}
function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie') ?? '';
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

async function gotrue(path: string, init: RequestInit & { bearer?: string } = {}): Promise<{ status: number; body: any }> {
  const { env } = getConfig();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, '')}/auth/v1${path}`, {
      ...init, signal: ctl.signal,
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, 'content-type': 'application/json', ...(init.bearer ? { authorization: `Bearer ${init.bearer}` } : {}) },
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  } catch {
    throw new ApiError(503, 'auth_unavailable', 'Sign-in service is not reachable right now.');
  } finally { clearTimeout(timer); }
}

const testMode = () => !!getConfig().env.PITCHREADY_TEST_DB_URL && !getConfig().production;

export async function authenticate(req: Request): Promise<AuthResult> {
  const at = readCookie(req, AT);
  if (testMode()) {
    // Test stub: the cookie holds a user UUID that must exist in the local auth.users table.
    if (!at || !/^[0-9a-f-]{36}$/.test(at)) return { user: null, setCookies: [] };
    const row = (await psql(getConfig().env.PITCHREADY_TEST_DB_URL!, `select email || '|' || (email_confirmed_at is not null) from auth.users where id = '${at}'`)).trim();
    if (!row) return { user: null, setCookies: [] };
    const [email, confirmed] = row.split('|');
    return { user: { id: at, email: email!, accessToken: at, emailConfirmed: confirmed === 'true' }, setCookies: [] };
  }
  if (!at) return { user: null, setCookies: [] };
  let r = await gotrue('/user', { method: 'GET', bearer: at });
  if (r.status === 200 && r.body?.id) return { user: toUser(r.body, at), setCookies: [] };
  const rt = readCookie(req, RT);
  if (!rt) return { user: null, setCookies: clearCookies() };
  const ref = await gotrue('/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: rt }) });
  if (ref.status !== 200 || !ref.body?.access_token) return { user: null, setCookies: clearCookies() };
  r = await gotrue('/user', { method: 'GET', bearer: ref.body.access_token });
  if (r.status !== 200) return { user: null, setCookies: clearCookies() };
  return { user: toUser(r.body, ref.body.access_token), setCookies: sessionCookies(ref.body.access_token, ref.body.refresh_token) };
}

function toUser(u: any, token: string): AuthUser {
  return { id: u.id, email: String(u.email ?? '').toLowerCase(), accessToken: token, emailConfirmed: !!u.email_confirmed_at };
}

export async function requireUser(req: Request): Promise<AuthResult & { user: AuthUser }> {
  const r = await authenticate(req);
  if (!r.user) throw new ApiError(401, 'unauthenticated', 'Please sign in.');
  return r as AuthResult & { user: AuthUser };
}

export async function signInWithPassword(email: string, password: string): Promise<string[]> {
  const r = await gotrue('/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (r.status === 400 && /confirm/i.test(JSON.stringify(r.body))) throw new ApiError(403, 'email_unconfirmed', 'Confirm your email address first — check your inbox for the link.');
  if (r.status !== 200 || !r.body?.access_token) throw new ApiError(401, 'invalid_credentials', 'Email or password is incorrect.');
  return sessionCookies(r.body.access_token, r.body.refresh_token);
}

export async function signUp(email: string, password: string): Promise<{ confirmationRequired: boolean; cookies: string[] }> {
  const redirect = `${getConfig().env.APP_BASE_URL}/login`;
  const r = await gotrue(`/signup?redirect_to=${encodeURIComponent(redirect)}`, { method: 'POST', body: JSON.stringify({ email, password }) });
  if (r.status === 429) throw new ApiError(429, 'rate_limited', 'Too many attempts. Please wait and try again.');
  if (r.status >= 400) throw new ApiError(400, 'signup_failed', 'Could not create the account. If you already have one, sign in instead.');
  if (r.body?.access_token) return { confirmationRequired: false, cookies: sessionCookies(r.body.access_token, r.body.refresh_token) };
  return { confirmationRequired: true, cookies: [] };
}

export async function adoptSession(accessToken: string, refreshToken: string): Promise<string[]> {
  const r = await gotrue('/user', { method: 'GET', bearer: accessToken });
  if (r.status !== 200) throw new ApiError(401, 'invalid_session', 'That sign-in link is no longer valid.');
  return sessionCookies(accessToken, refreshToken);
}

export async function signOut(req: Request): Promise<string[]> {
  const at = readCookie(req, AT);
  if (at && !testMode()) await gotrue('/logout', { method: 'POST', bearer: at }).catch(() => undefined);
  return clearCookies();
}
