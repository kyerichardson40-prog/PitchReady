import { authed } from '../../../../server/guard.ts';
import { getDb } from '../../../../server/db.ts';
import { computeOverview } from '../../../../lib/domain/metrics.ts';

export const GET = authed(async (req, { user }) => {
  const days = Number(new URL(req.url).searchParams.get('days') ?? '14');
  const periodDays = [7, 14, 30].includes(days) ? days : 14;
  const s: any = await getDb().user(user.accessToken, user.id).rpc('manager_summaries');
  const o = computeOverview({ sessions: s.sessions, activeRepIds: s.activeRepIds, periodDays, now: new Date(), currentRubricVersion: s.currentRubricVersion ?? '' });
  const u = s.usage ?? { allowanceSeconds: 0, consumedSeconds: 0, reservedSeconds: 0 };
  return { ...o, allowanceSeconds: u.allowanceSeconds, remainingSeconds: u.allowanceSeconds - u.consumedSeconds - u.reservedSeconds };
});
