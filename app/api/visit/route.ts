import { z } from 'zod';
import { open } from '../../../server/guard.ts';
import { readJson } from '../../../server/http.ts';
import { getDb } from '../../../server/db.ts';
import { getConfig } from '../../../server/config.ts';
import { isBot, normalizePath, sourceFromReferrer } from '../../../lib/domain/visits.ts';

/**
 * Counts one page view (D47). Anonymous and cookie-free: no IP, user or device is stored, only the
 * page, the UK date and, for the first page of a visit, the website that linked here.
 */
const input = z.object({ path: z.string().max(400), referrer: z.string().max(1000).optional(), entry: z.boolean().optional() }).strict();

export const POST = open(async (req) => {
  const b = await readJson(req, input);
  const path = normalizePath(b.path);
  if (!path || isBot(req.headers.get('user-agent'))) return { counted: false };
  const ownHost = new URL(getConfig().env.APP_BASE_URL).hostname;
  const source = b.entry ? sourceFromReferrer(b.referrer, ownHost) : '';
  // A visit that starts from another page of this site (e.g. a reload) is not a new arrival.
  const entry = !!b.entry && (!b.referrer || source !== '');
  await getDb().service().rpc('record_page_view', { path, source, entry });
  return { counted: true };
}, { rate: { name: 'visit', perMinute: 60 } });
