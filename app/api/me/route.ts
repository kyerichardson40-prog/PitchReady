import { salesContextOf } from '../../../lib/domain/sales.ts';
import { open } from '../../../server/guard.ts';
import { authenticate } from '../../../server/auth.ts';
import { getDb } from '../../../server/db.ts';
import { getConfig } from '../../../server/config.ts';
import { json } from '../../../server/http.ts';

/** Context for the signed-in user (or user: null). Server-side only data; no secrets. */
export const GET = open(async (req, { rid }) => {
  const auth = await authenticate(req);
  const cfg = getConfig();
  const base = { mode: 'connected', voice: { stt: cfg.voice.stt, tts: cfg.voice.tts, deviceVoice: false }, liveAi: cfg.liveAi, scenarios: [] };
  if (!auth.user) {
    const res = json({ ...base, user: null, membershipActive: false, agencyName: null, campaign: null, rubricVersion: null, usage: null, retentionDays: null }, { requestId: rid });
    auth.setCookies.forEach((c) => res.headers.append('set-cookie', c));
    return res;
  }
  const c: any = await getDb().user(auth.user.accessToken, auth.user.id).rpc('my_context');
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
    } : null,
    rubricVersion: c?.campaign?.rubricVersion ?? null,
    scenarios: c?.scenarios ?? [],
    usage: c?.usage ?? null,
    retentionDays: c?.agency?.retentionDays ?? null,
  }, { requestId: rid });
  auth.setCookies.forEach((x) => res.headers.append('set-cookie', x));
  return res;
});
