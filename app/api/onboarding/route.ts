import { z } from 'zod';
import { authed } from '../../../server/guard.ts';
import { readJson } from '../../../server/http.ts';
import { getDb } from '../../../server/db.ts';
import { onboardingOptions } from '../../../lib/content/onboarding.ts';

/** Saves the first-time answers. Only the listed options are accepted; "other" is free text. */
const input = z.object({
  role: z.enum(['rep', 'manager']),
  struggles: z.array(z.string().max(40)).max(12),
  strugglesOther: z.string().trim().max(500).optional(),
  goals: z.array(z.string().max(40)).max(12),
  goalsOther: z.string().trim().max(500).optional(),
  skipped: z.boolean().optional(),
}).strict();

export const POST = authed(async (req, { user }) => {
  const b = await readJson(req, input);
  const opts = onboardingOptions(b.role);
  const ok = (list: string[], allowed: { key: string }[]) => list.filter((k) => allowed.some((o) => o.key === k));
  return getDb().user(user.accessToken, user.id).rpc('save_onboarding', {
    role: b.role, struggles: ok(b.struggles, opts.struggles), struggles_other: b.strugglesOther ?? '',
    goals: ok(b.goals, opts.goals), goals_other: b.goalsOther ?? '', skipped: b.skipped ?? false,
  });
}, { rate: { name: 'onboarding', perMinute: 10 } });

/** Managers: what their team said. */
export const GET = authed(async (_req, { user }) => getDb().user(user.accessToken, user.id).rpc('team_onboarding', {}));
