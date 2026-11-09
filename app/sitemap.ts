import type { MetadataRoute } from 'next';
import { getConfig } from '../server/config.ts';

export const dynamic = 'force-dynamic';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = new URL(getConfig().env.APP_BASE_URL).origin;
  return ['', '/how-it-works', '/pricing', '/about', '/contact', '/terms', '/privacy', '/dpa'].map((p) => ({
    url: `${base}${p || '/'}`, changeFrequency: p === '' ? 'weekly' : 'monthly', priority: p === '' ? 1 : p === '/how-it-works' ? 0.8 : 0.5,
  }));
}
