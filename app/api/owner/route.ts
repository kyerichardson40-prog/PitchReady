import { z } from 'zod';
import { ownerOnly } from '../../../server/owner.ts';
import { ApiError, readJson } from '../../../server/http.ts';
import { getDb } from '../../../server/db.ts';
import { getConfig } from '../../../server/config.ts';
import { newInvitationToken } from '../../../server/tokens.ts';
import { bootstrapPayload } from '../../../lib/content/bootstrap-payload.ts';
import { SALES_TEMPLATES } from '../../../lib/content/templates.ts';
import { adminDeleteUser, requestPasswordReset } from '../../../server/auth.ts';
import { emailConfigured, invitationEmail, sendEmail } from '../../../server/services/notify.ts';
import { setCachedSiteSettings, type SiteSettings } from '../../../server/site-settings.ts';
import { runMaintenance } from '../../../server/services/maintenance.ts';
import { billingConfigured, checkCustomer, createCustomer, dashboardUrl } from '../../../server/services/billing.ts';

/**
 * Owner suite API. GET ?view=… reads; POST { action, … } changes. Owner only (OWNER_EMAILS), and
 * every change is recorded in the audit log with the owner as the actor.
 */
const uuid = z.string().uuid();
const svc = () => getDb().service();

export const GET = ownerOnly(async (req) => {
  const q = new URL(req.url).searchParams;
  switch (q.get('view')) {
    case 'overview': return svc().rpc('owner_overview', {});
    case 'teams': return svc().rpc('owner_list_teams', {});
    case 'team': return svc().rpc('owner_team_detail', { agency_id: uuid.parse(q.get('id')) });
    case 'users': return svc().rpc('owner_list_users', { q: (q.get('q') ?? '').slice(0, 100) });
    case 'messages': return svc().rpc('owner_list_messages', { status: z.enum(['open', 'all', 'new', 'replied', 'closed', 'spam']).catch('open').parse(q.get('status')) });
    case 'onboarding': return svc().rpc('owner_onboarding', {});
    case 'billing': {
      const b = await svc().rpc<Record<string, any>>('owner_billing', { agency_id: uuid.parse(q.get('id')) });
      return { ...b, available: billingConfigured(),
        dashboardUrl: b?.customerId ? dashboardUrl(`customers/${b.customerId}`) : null,
        subscriptionUrl: b?.subscriptionId ? dashboardUrl(`subscriptions/${b.subscriptionId}`) : null };
    }
    case 'activity': return svc().rpc('owner_activity', { owner_only: q.get('ownerOnly') === '1' ? 'true' : 'false' });
    case 'settings': return {
      settings: await svc().rpc('site_settings', {}),
      templates: SALES_TEMPLATES.map((t) => ({ id: t.id, label: t.label })),
      env: { pilotsSwitch: getConfig().env.SELF_SERVE_PILOTS === 'true', emails: emailConfigured(), liveAi: getConfig().liveAi },
    };
    default: throw new ApiError(400, 'invalid_input', 'Unknown view.');
  }
});

const settingsInput = z.object({
  pilotsEnabled: z.boolean(), pilotSeconds: z.number().int().min(60).max(360000), pilotDays: z.number().int().min(1).max(90),
  pilotDailyCap: z.number().int().min(0).max(1000), practicePaused: z.boolean(), practicePausedMessage: z.string().max(300),
  voiceEnabled: z.boolean(), announcement: z.string().max(300), announcementTone: z.enum(['info', 'warn']),
}).partial().strict();

const action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('settings'), settings: settingsInput }),
  z.object({ action: z.literal('updateTeam'), agencyId: uuid, name: z.string().trim().min(1).max(120).optional(), status: z.enum(['active', 'suspended']).optional(),
    seatLimit: z.number().int().min(1).max(500).optional(), retentionDays: z.number().int().min(1).max(365).optional(),
    renewAllowanceSeconds: z.number().int().min(60).max(6000000).nullable().optional(), renewPeriodDays: z.number().int().min(1).max(366).optional(),
    emailNotifications: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('adjustAllowance'), agencyId: uuid, addSeconds: z.number().int().min(-6000000).max(6000000), newPeriod: z.boolean().optional(), days: z.number().int().min(1).max(366).optional() }).strict(),
  z.object({ action: z.literal('createTeam'), name: z.string().trim().min(1).max(120), managerEmail: z.string().trim().toLowerCase().email().max(254), managerName: z.string().trim().max(80).optional(),
    templateId: z.string().max(60).optional(), allowanceMinutes: z.number().int().min(1).max(100000), periodDays: z.number().int().min(1).max(366), renew: z.boolean(),
    seatLimit: z.number().int().min(1).max(500), retentionDays: z.number().int().min(1).max(365) }).strict(),
  z.object({ action: z.literal('deleteTeam'), agencyId: uuid, confirmName: z.string().max(120) }).strict(),
  z.object({ action: z.literal('updateMember'), userId: uuid, role: z.enum(['manager', 'rep']).optional(), active: z.boolean().optional(), remove: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('resetPassword'), email: z.string().trim().toLowerCase().email().max(254) }).strict(),
  z.object({ action: z.literal('deleteUser'), userId: uuid, confirmEmail: z.string().trim().toLowerCase().max(254) }).strict(),
  z.object({ action: z.literal('messageStatus'), id: uuid, status: z.enum(['new', 'replied', 'closed', 'spam']) }).strict(),
  z.object({ action: z.literal('runMaintenance') }).strict(),
  z.object({ action: z.literal('linkBilling'), agencyId: uuid, create: z.boolean().optional(), customerId: z.string().trim().regex(/^cus_[A-Za-z0-9]+$/, 'A Stripe customer ID starts with cus_').nullable().optional() }).strict(),
]);

export const POST = ownerOnly(async (req, { user }) => {
  const a = await readJson(req, action);
  const actor = user.id;
  switch (a.action) {
    case 'settings': {
      const s = await svc().rpc<SiteSettings>('owner_update_settings', { actor_id: actor, ...a.settings });
      setCachedSiteSettings(s);
      return s;
    }
    case 'updateTeam': {
      const { agencyId, action: _a, ...rest } = a;
      return svc().rpc('owner_update_team', { actor_id: actor, agency_id: agencyId, ...rest });
    }
    case 'adjustAllowance':
      return svc().rpc('owner_adjust_allowance', { actor_id: actor, agency_id: a.agencyId, add_seconds: a.addSeconds, new_period: a.newPeriod ?? false, days: a.days ?? 30 });
    case 'createTeam': {
      const tpl = SALES_TEMPLATES.find((t) => t.id === a.templateId);
      const payload = bootstrapPayload({ agencyName: a.name, managerEmail: a.managerEmail, managerName: a.managerName, allowanceSeconds: a.allowanceMinutes * 60, periodDays: a.periodDays, template: tpl });
      const { token, hash } = newInvitationToken();
      const r: any = await svc().rpc('owner_create_team', {
        actor_id: actor, agency_name: a.name, manager_email: a.managerEmail, manager_name: a.managerName ?? null, allowance_seconds: a.allowanceMinutes * 60,
        period_days: a.periodDays, renew: a.renew, seat_limit: a.seatLimit, retention_days: a.retentionDays, payload, token_hash_hex: hash,
      });
      if (r.managerAdded) return { ...r, inviteLink: null, emailed: false };
      const link = `${getConfig().env.APP_BASE_URL}/invite/${token}`;
      let emailed = false;
      if (emailConfigured()) {
        const { subject, text } = invitationEmail({ agencyName: a.name, inviterName: 'PitchReady', role: 'manager', link, expiresAt: new Date(Date.now() + 14 * 86400_000).toISOString() });
        emailed = (await sendEmail({ to: [a.managerEmail], subject, text, replyTo: user.email, tag: 'owner-invite' })) === 'sent';
      }
      return { ...r, inviteLink: link, emailed };
    }
    case 'deleteTeam':
      return svc().rpc('owner_delete_team', { actor_id: actor, agency_id: a.agencyId, confirm_name: a.confirmName });
    case 'updateMember': {
      const { userId, action: _a, ...rest } = a;
      if (userId === actor && (rest.active === false || rest.remove)) throw new ApiError(400, 'invalid_input', 'You can’t remove your own access here.');
      return svc().rpc('owner_update_member', { actor_id: actor, user_id: userId, ...rest });
    }
    case 'resetPassword':
      await requestPasswordReset(a.email);
      return { ok: true };
    case 'deleteUser': {
      if (a.userId === actor) throw new ApiError(400, 'invalid_input', 'You can’t delete your own account here.');
      const users: any[] = await svc().rpc('owner_list_users', { q: a.confirmEmail });
      const target = users.find((x) => x.userId === a.userId);
      if (!target || target.email.toLowerCase() !== a.confirmEmail) throw new ApiError(400, 'invalid_input', 'Type the account’s email exactly to confirm.');
      const can: any = await svc().rpc('owner_can_delete_user', { user_id: a.userId });
      if (!can.ok) throw new ApiError(409, 'has_history', 'This account is in a team or has review history. Remove them from the team first, or deactivate them instead.');
      await adminDeleteUser(a.userId);
      return { ok: true };
    }
    case 'messageStatus':
      return svc().rpc('owner_set_message_status', { actor_id: actor, id: a.id, status: a.status });
    case 'linkBilling': {
      if (a.customerId === null) return svc().rpc('owner_link_billing', { actor_id: actor, agency_id: a.agencyId, customer_id: null });
      if (!billingConfigured()) throw new ApiError(503, 'billing_unavailable', 'Add STRIPE_SECRET_KEY in Railway first.');
      let customerId = a.customerId;
      if (a.create) {
        const t = await svc().rpc<{ name: string; members: { email: string; role: string; active: boolean }[] }>('owner_team_detail', { agency_id: a.agencyId });
        const manager = t.members.find((m) => m.role === 'manager' && m.active);
        customerId = await createCustomer({ id: a.agencyId, name: t.name, email: manager?.email ?? null });
      } else if (customerId) {
        await checkCustomer(customerId, a.agencyId);
      } else throw new ApiError(400, 'invalid_input', 'Create a customer or give a Stripe customer ID.');
      return svc().rpc('owner_link_billing', { actor_id: actor, agency_id: a.agencyId, customer_id: customerId });
    }
    case 'runMaintenance':
      return runMaintenance();
  }
}, { rate: { name: 'owner-write', perMinute: 60 } });
