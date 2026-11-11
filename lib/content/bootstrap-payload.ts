import { FICTIONAL_CAMPAIGN } from './campaign.ts';
import { DEMO_RUBRIC } from './rubric.ts';
import { SCENARIOS } from './scenarios.ts';
import type { SalesTemplate } from './templates.ts';

/** Payload for app_private.bootstrap_agency, built from the single source of fictional content. */
/**
 * With a template, the team starts with that kind of selling: its campaign, and its scenarios placed
 * on the built-in scenario keys (so retry drills keep working).
 */
export function bootstrapPayload(opts: { agencyName: string; managerEmail: string; managerName?: string; allowanceSeconds?: number; periodDays?: number; seatLimit?: number; retentionDays?: number; template?: SalesTemplate }) {
  const t = opts.template;
  const scenarios = t ? SCENARIOS.map((s, i) => (t.scenarios[i] ? { ...s, ...t.scenarios[i], key: s.key } : s)) : SCENARIOS;
  return {
    agency_name: opts.agencyName,
    manager_email: opts.managerEmail,
    manager_name: opts.managerName,
    allowance_seconds: opts.allowanceSeconds ?? 9000,
    period_days: opts.periodDays ?? 14,
    seat_limit: opts.seatLimit ?? 5,
    retention_days: opts.retentionDays ?? 30,
    campaign: t ? { ...t.pack, version: 1 } : FICTIONAL_CAMPAIGN,
    rubric: { version: DEMO_RUBRIC.version, prompt_version: DEMO_RUBRIC.promptVersion, dimensions: DEMO_RUBRIC.dimensions },
    scenarios,
  };
}
