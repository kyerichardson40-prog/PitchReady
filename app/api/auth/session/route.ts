import { z } from 'zod';
import { open } from '../../../../server/guard.ts';
import { json, readJson } from '../../../../server/http.ts';
import { adoptSession } from '../../../../server/auth.ts';

/** Adopts tokens from a Supabase email-confirmation link (URL fragment) after verifying them server-side. */
const input = z.object({ accessToken: z.string().min(20).max(4000), refreshToken: z.string().min(10).max(500) }).strict();
export const POST = open(async (req, { rid }) => {
  const { accessToken, refreshToken } = await readJson(req, input);
  const cookies = await adoptSession(accessToken, refreshToken);
  const res = json({ ok: true }, { requestId: rid });
  cookies.forEach((c) => res.headers.append('set-cookie', c));
  return res;
}, { rate: { name: 'adopt', perMinute: 10 } });
