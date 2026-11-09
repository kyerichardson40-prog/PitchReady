import { z } from 'zod';
import { open } from '../../../server/guard.ts';
import { json, readJson } from '../../../server/http.ts';
import { getDb } from '../../../server/db.ts';

/**
 * Public contact form. Same-origin only, 3 messages per minute per IP, a database-wide hourly cap,
 * and a hidden "website" field that people never fill in (bots usually do: those are dropped
 * silently). Messages are stored in public.contact_messages; nothing is emailed.
 */
const input = z.object({
  name: z.string().trim().min(1, 'Please add your name').max(120),
  email: z.string().trim().toLowerCase().email('Please check your email address').max(254),
  company: z.string().trim().max(160).optional().default(''),
  team_size: z.string().trim().max(40).optional().default(''),
  sales_type: z.string().trim().max(60).optional().default(''),
  message: z.string().trim().min(10, 'Please write a little more (at least 10 characters)').max(4000),
  website: z.string().max(200).optional().default(''),
}).strict();

export const POST = open(async (req, { rid }) => {
  const body = await readJson(req, input);
  if (body.website) return json({ ok: true }, { requestId: rid });
  const { website: _w, ...fields } = body;
  await getDb().service().rpc('submit_contact', fields);
  return json({ ok: true }, { requestId: rid });
}, { rate: { name: 'contact', perMinute: 3 } });
