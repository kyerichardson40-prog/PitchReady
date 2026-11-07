import { z } from 'zod';
import { open } from '../../../../server/guard.ts';
import { json, readJson } from '../../../../server/http.ts';
import { signInWithPassword } from '../../../../server/auth.ts';

const input = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(1).max(200) }).strict();
export const POST = open(async (req, { rid }) => {
  const { email, password } = await readJson(req, input);
  const cookies = await signInWithPassword(email, password);
  const res = json({ ok: true }, { requestId: rid });
  cookies.forEach((c) => res.headers.append('set-cookie', c));
  return res;
}, { rate: { name: 'sign-in', perMinute: 10 } });
