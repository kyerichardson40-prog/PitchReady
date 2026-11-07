import { randomUUID } from 'node:crypto';
import type { ZodType } from 'zod';
import { getConfig } from './config.ts';

/** Errors carry a safe message and stable code. Raw provider/database errors never reach clients. */
export class ApiError extends Error {
  status: number; code: string; detail?: unknown;
  constructor(status: number, code: string, message: string, detail?: unknown) {
    super(message); this.status = status; this.code = code; this.detail = detail;
  }
}

export function requestId(req: Request): string {
  const h = req.headers.get('x-request-id');
  return h && /^[A-Za-z0-9-]{8,64}$/.test(h) ? h : randomUUID();
}

export function json(data: unknown, init: ResponseInit & { requestId?: string } = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  if (init.requestId) headers.set('x-request-id', init.requestId);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(err: unknown, rid: string): Response {
  if (err instanceof ApiError) {
    return json({ error: { code: err.code, message: err.message, requestId: rid } }, { status: err.status, requestId: rid });
  }
  // Log server-side with the request ID only; do not echo internals.
  console.error(`[${rid}] unhandled`, err instanceof Error ? err.message : err);
  return json({ error: { code: 'internal_error', message: 'Something went wrong on our side. Please try again.', requestId: rid } }, { status: 500, requestId: rid });
}

export async function readJson<T>(req: Request, schema: ZodType<T>, maxBytes = 64 * 1024): Promise<T> {
  const ct = req.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) throw new ApiError(415, 'unsupported_media_type', 'Send JSON.');
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > maxBytes) throw new ApiError(413, 'payload_too_large', 'Request is too large.');
  const text = await req.text();
  if (text.length > maxBytes) throw new ApiError(413, 'payload_too_large', 'Request is too large.');
  let body: unknown;
  try { body = text ? JSON.parse(text) : {}; } catch { throw new ApiError(400, 'invalid_json', 'Request body is not valid JSON.'); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, 'invalid_input', 'Some fields are missing or invalid.', parsed.error.issues.map((i) => i.path.join('.')));
  return parsed.data;
}

/**
 * CSRF defence for cookie-authenticated mutations: require same-origin Origin (or Sec-Fetch-Site)
 * in addition to SameSite=Lax cookies.
 */
export function assertSameOrigin(req: Request) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const base = new URL(getConfig().env.APP_BASE_URL);
  const origin = req.headers.get('origin');
  const site = req.headers.get('sec-fetch-site');
  if (origin) {
    if (origin !== base.origin) throw new ApiError(403, 'bad_origin', 'Request origin not allowed.');
    return;
  }
  if (site && site !== 'same-origin') throw new ApiError(403, 'bad_origin', 'Request origin not allowed.');
  if (!site) throw new ApiError(403, 'bad_origin', 'Request origin missing.');
}

// ---- simple per-instance rate limiter (documented: use a shared store for multi-instance hosting) ----
const buckets = new Map<string, { tokens: number; updated: number }>();
export function rateLimit(key: string, perMinute: number, burst = perMinute) {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: burst, updated: now };
  b.tokens = Math.min(burst, b.tokens + ((now - b.updated) / 60000) * perMinute);
  b.updated = now;
  if (b.tokens < 1) { buckets.set(key, b); throw new ApiError(429, 'rate_limited', 'Too many requests. Please wait a moment and try again.'); }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 10_000) for (const [k, v] of buckets) if (now - v.updated > 600_000) buckets.delete(k);
}
export function resetRateLimits() { buckets.clear(); }

export type RouteContext = { params: Promise<Record<string, string>> };
export type Handler = (req: Request, ctx: RouteContext) => Promise<Response>;

/** Wraps a route handler with request ID, mode guard and safe error handling. */
export function route(fn: (req: Request, ctx: { params: Record<string, string>; rid: string }) => Promise<Response>): Handler {
  return async (req, ctx) => {
    const rid = requestId(req);
    try {
      const cfg = getConfig();
      if (cfg.mode !== 'connected') throw new ApiError(404, 'demo_mode', 'The server API is disabled in demo mode; the demo runs in your browser.');
      const params = await ctx.params;
      const res = await fn(req, { params, rid });
      res.headers.set('x-request-id', rid);
      return res;
    } catch (e) {
      return errorResponse(e, rid);
    }
  };
}
