import { getConfig } from './config.ts';
import { ApiError } from './http.ts';
import { authed } from './guard.ts';
import type { AuthUser } from './auth.ts';

/**
 * The site owner(s): the email addresses in OWNER_EMAILS (comma-separated), signed in with a
 * confirmed email. Decided on the server only; owner database functions are service-role only and
 * are never reachable with a user's own token.
 */
export function ownerEmails(env: { OWNER_EMAILS?: string } = getConfig().env): string[] {
  return (env.OWNER_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function isOwner(user: Pick<AuthUser, 'email' | 'emailConfirmed'> | null | undefined, env?: { OWNER_EMAILS?: string }): boolean {
  if (!user?.emailConfirmed || !user.email) return false;
  return ownerEmails(env).includes(user.email.toLowerCase());
}

type OwnerCtx = { params: Record<string, string>; rid: string; user: AuthUser };

/** Like `authed`, but only for the owner. Anyone else gets a plain 404. */
export function ownerOnly(fn: (req: Request, ctx: OwnerCtx) => Promise<Response | unknown>, opts: { rate?: { name: string; perMinute: number } } = {}) {
  return authed(async (req, ctx) => {
    if (!isOwner(ctx.user)) throw new ApiError(404, 'not_found', 'Not found.');
    return fn(req, ctx);
  }, { rate: opts.rate ?? { name: 'owner', perMinute: 120 } });
}
