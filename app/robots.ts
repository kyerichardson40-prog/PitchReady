import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { getConfig } from '../server/config.ts';

/**
 * Only the main address (APP_BASE_URL) is offered to search engines; preview copies and the demo
 * are kept out. Signed-in areas are never listed.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const cfg = getConfig();
  const base = new URL(cfg.env.APP_BASE_URL);
  const h = await headers();
  const host = (h.get('x-forwarded-host') ?? h.get('host') ?? '').split(',')[0]!.trim();
  if (cfg.mode !== 'connected' || (host && host !== base.host)) return { rules: [{ userAgent: '*', disallow: '/' }] };
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/practice', '/manager', '/sessions', '/history', '/settings', '/invite', '/start', '/login'] }],
    sitemap: `${base.origin}/sitemap.xml`,
  };
}
