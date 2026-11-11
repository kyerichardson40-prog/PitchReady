import { practiceMinutesOf } from '../../../lib/domain/limits.ts';
import { salesContextOf } from '../../../lib/domain/sales.ts';
import { open } from '../../../server/guard.ts';
import { authenticate } from '../../../server/auth.ts';
import { getDb } from '../../../server/db.ts';
import { getConfig } from '../../../server/config.ts';
import { json, readJson } from '../../../server/http.ts';
import { authed } from '../../../server/guard.ts';
import { z } from 'zod';
import { siteSettings } from '../../../server/site-settings.ts';
import { isOwner } from '../../../server/owner.ts';

/** Context for the signed-in user (or user: null). Server-side only data; no secrets. */
export const GET = open(async (req, { rid }) => {
  const auth = await authenticate(req);
  const cfg = getConfig();
  const site = await siteSettings();
  const pilotsOpen = cfg.env.SELF_SERVE_PILOTS === 'true' && site.pilotsEnabled;
  const base = {
    mode: 'connected', voice: { stt: cfg.voice.stt && site.voiceEnabled, tts: cfg.voice.tts && site.voiceEnabled, deviceVoice: false }, liveAi: cfg.liveAi, scenarios: [], pilotsOpen,
    announcement: site.announcement ? { text: site.announcement, tone: site.announcementTone } : null,
    practicePaused: site.practicePaused ? (site.practicePausedMessage || 'Practice is paused for a short while. Please try again later.') : null,
    pilot: { minutes: Math.round(site.pilotSeconds / 60), days: site.pilotDays },
  };
  if (!auth.user) {
    const res = json({ ...base, user: null, membershipActive: false, agencyName: null, campaign: null, rubricVersion: null, usage: null, retentionDays: null, emailNotifications: null, hasTeam: false, canStartPilot: false }, { requestId: rid });
    auth.setCookies.forEach((c) => res.headers.append('set-cookie', c));
    return res;
  }
  const db = getDb().user(auth.user.accessToken, auth.user.id);
  const [c, onboarding]: any[] = await Promise.all([
    db.rpc('my_context'),
    // Before the onboarding migration is applied, nobody is asked.
    db.rpc('my_onboarding', {}).catch(() => ({ done: true })),
  ]);
  const m = c?.membership;
  const res = json({
    ...base,
    user: { id: auth.user.id, email: auth.user.email, name: c?.profile?.displayName ?? auth.user.email, role: m?.role ?? 'rep' },
    membershipActive: !!m?.active,
    agencyName: c?.agency?.name ?? null,
    campaign: c?.campaign ? {
      version: c.campaign.version, name: c.campaign.pack.name, fictional: !!c.campaign.pack.fictional, organisation: c.campaign.pack.organisation, facts: c.campaign.pack.approved_facts,
      mustSay: c.campaign.pack.must_say ?? [], neverSay: c.campaign.pack.never_say ?? [], forbiddenClaims: c.campaign.pack.forbidden_claims ?? [], objectionAnswers: c.campaign.pack.objection_answers ?? [],
      salesContext: salesContextOf(c.campaign.pack),
      practiceMinutes: practiceMinutesOf(c.campaign.pack),
    } : null,
    rubricVersion: c?.campaign?.rubricVersion ?? null,
    scenarios: c?.scenarios ?? [],
    usage: c?.usage ?? null,
    retentionDays: c?.agency?.retentionDays ?? null,
    emailNotifications: c?.agency?.emailNotifications ?? null,
    hasTeam: !!m,
    canStartPilot: !m && pilotsOpen,
    isOwner: isOwner(auth.user),
    onboarding,
    emailConfirmed: auth.user.emailConfirmed,
  }, { requestId: rid });
  auth.setCookies.forEach((x) => res.headers.append('set-cookie', x));
  return res;
});

/** Change your own display name. */
const nameInput = z.object({ name: z.string().trim().min(1).max(80) }).strict();
export const PUT = authed(async (req, { user }) => {
  const { name } = await readJson(req, nameInput);
  return getDb().user(user.accessToken, user.id).rpc('update_profile', { display_name: name });
}, { rate: { name: 'profile', perMinute: 10 } });
