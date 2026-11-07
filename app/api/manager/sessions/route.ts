import { authed } from '../../../../server/guard.ts';
import { getDb } from '../../../../server/db.ts';

export const GET = authed(async (_req, { user }) => {
  const s: any = await getDb().user(user.accessToken, user.id).rpc('manager_summaries');
  return s.sessions.filter((x: any) => x.status !== 'active' && x.status !== 'created').map((x: any) => ({
    id: x.id, repName: x.repName, scenarioKey: x.scenarioKey, drillKey: x.drillKey, endedAt: x.endedAt, status: x.status,
    evaluationStatus: x.evaluationStatus, openConcerns: x.openConcerns, openReports: x.openReports,
  }));
});
