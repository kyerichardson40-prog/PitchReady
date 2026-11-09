import { z } from 'zod';
import { authed } from '../../../../server/guard.ts';
import { readJson } from '../../../../server/http.ts';
import { changePassword, isRecoverySession } from '../../../../server/auth.ts';

const input = z.object({ newPassword: z.string().min(10).max(200), currentPassword: z.string().min(1).max(200).optional() }).strict();

/** Whether the current sign-in came from a reset link (so the form can skip "current password"). */
export const GET = authed(async (_req, { user }) => ({ recovery: isRecoverySession(user.accessToken) }));

export const POST = authed(async (req, { user }) => {
  const { newPassword, currentPassword } = await readJson(req, input);
  await changePassword(user, newPassword, currentPassword);
  return { ok: true };
}, { rate: { name: 'password', perMinute: 5 } });
