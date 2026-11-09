import { z } from 'zod';
import { authed } from '../../../../server/guard.ts';
import { readJson } from '../../../../server/http.ts';
import { getDb } from '../../../../server/db.ts';

/** Team settings a manager can change: how long practice data is kept, and manager emails. */
const input = z.object({
  retentionDays: z.number().int().min(1).max(365).optional(),
  emailNotifications: z.boolean().optional(),
}).strict();

export const PUT = authed(async (req, { user }) => {
  const b = await readJson(req, input);
  return getDb().user(user.accessToken, user.id).rpc('update_agency_settings', {
    retention_days: b.retentionDays ?? null, email_notifications: b.emailNotifications ?? null,
  });
}, { rate: { name: 'settings', perMinute: 10 } });
