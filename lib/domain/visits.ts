/** Site visit counting (DECISIONS D47): what is kept is only a page, a day and a source website. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** "/manager/reps/3f2a…?tab=x" → "/manager/reps/:id"; invitation tokens and long ids are hidden. */
export function normalizePath(raw: string): string | null {
  let p = String(raw || '').split(/[?#]/)[0] ?? '';
  if (!p.startsWith('/') || p.startsWith('//')) return null;
  p = p.replace(UUID, ':id').replace(/^\/invite\/[^/]+/, '/invite/:token').replace(/\/{2,}/g, '/');
  if (p.length > 1) p = p.replace(/\/$/, '');
  if (p.length > 120 || /[^\w\-/:.]/.test(p)) return null;
  return p;
}

/** The website that linked here, as a short host ("google.com"), or "" for direct visits and apps that hide it. */
export function sourceFromReferrer(referrer: string | null | undefined, ownHost: string): string {
  if (!referrer) return '';
  let host: string;
  try { host = new URL(referrer).hostname.toLowerCase(); } catch { return ''; }
  if (!host || host === ownHost.toLowerCase()) return '';
  host = host.replace(/^(www|m|l|lm|out)\./, '');
  return host.slice(0, 80);
}

/** Crawlers, link previewers and monitoring tools are not visitors. */
export function isBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true;
  return /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|embedly|monitor|headless|lighthouse|curl|wget|python|axios|node-fetch|go-http/i.test(userAgent);
}
