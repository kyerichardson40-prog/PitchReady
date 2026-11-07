import { connectedReady, getConfig } from './config.ts';
import { ApiError, assertSameOrigin, json, rateLimit, route, type Handler } from './http.ts';
import { requireUser, type AuthUser } from './auth.ts';

interface Opts { rate?: { name: string; perMinute: number }; public?: boolean }
type Ctx = { params: Record<string, string>; rid: string; user: AuthUser };

/** Connected-mode route: config check → same-origin (mutations) → auth → rate limit → handler. */
export function authed(fn: (req: Request, ctx: Ctx) => Promise<Response | unknown>, opts: Opts = {}): Handler {
  return route(async (req, { params, rid }) => {
    if (!connectedReady(getConfig())) throw new ApiError(503, 'not_configured', 'Connected mode is not configured. See README → Connected setup.');
    assertSameOrigin(req);
    const auth = await requireUser(req);
    if (opts.rate) rateLimit(`${opts.rate.name}:${auth.user.id}`, opts.rate.perMinute);
    const out = await fn(req, { params, rid, user: auth.user });
    const res = out instanceof Response ? out : json(out, { requestId: rid });
    for (const c of auth.setCookies) res.headers.append('set-cookie', c);
    return res;
  });
}

/** Connected-mode route that does not require a signed-in user (sign-in, invitation landing). */
export function open(fn: (req: Request, ctx: { params: Record<string, string>; rid: string }) => Promise<Response | unknown>, opts: { rate?: { name: string; perMinute: number } } = {}): Handler {
  return route(async (req, { params, rid }) => {
    if (!connectedReady(getConfig())) throw new ApiError(503, 'not_configured', 'Connected mode is not configured. See README → Connected setup.');
    assertSameOrigin(req);
    if (opts.rate) {
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
      rateLimit(`${opts.rate.name}:${ip}`, opts.rate.perMinute);
    }
    const out = await fn(req, { params, rid });
    return out instanceof Response ? out : json(out, { requestId: rid });
  });
}

export function uuidParam(v: string | undefined): string {
  if (!v || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) throw new ApiError(404, 'not_found', 'Not found.');
  return v.toLowerCase();
}
