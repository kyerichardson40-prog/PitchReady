import { getDb } from './db.ts';

/** Site-wide switches the owner controls (public.site_settings). */
export interface SiteSettings {
  pilotsEnabled: boolean; pilotSeconds: number; pilotDays: number; pilotDailyCap: number;
  practicePaused: boolean; practicePausedMessage: string | null;
  voiceEnabled: boolean; announcement: string | null; announcementTone: 'info' | 'warn'; updatedAt?: string;
}

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  pilotsEnabled: true, pilotSeconds: 3600, pilotDays: 14, pilotDailyCap: 20,
  practicePaused: false, practicePausedMessage: null, voiceEnabled: true, announcement: null, announcementTone: 'info',
};

// Read on every page load, so kept for 15 seconds; an owner change clears it straight away.
let cached: { at: number; value: SiteSettings } | null = null;
const TTL_MS = 15_000;

export async function siteSettings(): Promise<SiteSettings> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  try {
    const v = await getDb().service().rpc<SiteSettings>('site_settings', {});
    cached = { at: Date.now(), value: { ...DEFAULT_SITE_SETTINGS, ...(v ?? {}) } };
  } catch {
    // Before the migration is applied (or if the database is briefly unreachable): safe defaults.
    cached = { at: Date.now(), value: cached?.value ?? DEFAULT_SITE_SETTINGS };
  }
  return cached.value;
}

export function setCachedSiteSettings(v: SiteSettings) { cached = { at: Date.now(), value: v }; }
