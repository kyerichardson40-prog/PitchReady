import { z } from 'zod';
import { open } from '../../../../server/guard.ts';
import { json, readJson } from '../../../../server/http.ts';
import { requestPasswordReset } from '../../../../server/auth.ts';

/** Always answers ok, so nobody can use it to find out which emails have accounts. */
const input = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict();
export const POST = open(async (req, { rid }) => {
  const { email } = await readJson(req, input);
  await requestPasswordReset(email);
  return json({ ok: true }, { requestId: rid });
}, { rate: { name: 'forgot', perMinute: 3 } });
