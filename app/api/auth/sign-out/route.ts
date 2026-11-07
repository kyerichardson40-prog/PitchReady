import { open } from '../../../../server/guard.ts';
import { json } from '../../../../server/http.ts';
import { signOut } from '../../../../server/auth.ts';

export const POST = open(async (req, { rid }) => {
  const cookies = await signOut(req);
  const res = json({ ok: true }, { requestId: rid });
  cookies.forEach((c) => res.headers.append('set-cookie', c));
  return res;
});
