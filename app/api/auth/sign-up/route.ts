import { z } from 'zod';
import { open } from '../../../../server/guard.ts';
import { json, readJson } from '../../../../server/http.ts';
import { signUp } from '../../../../server/auth.ts';

/** Creating an auth account grants NO access: membership comes only from accepting an invitation. */
const input = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(10).max(200) }).strict();
export const POST = open(async (req, { rid }) => {
  const { email, password } = await readJson(req, input);
  const r = await signUp(email, password);
  const res = json({ ok: true, confirmationRequired: r.confirmationRequired }, { requestId: rid });
  r.cookies.forEach((c) => res.headers.append('set-cookie', c));
  return res;
}, { rate: { name: 'sign-up', perMinute: 5 } });
