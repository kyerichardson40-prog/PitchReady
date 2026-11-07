/**
 * Rep database for connected mode: composes the manager's roster, session summaries and scenario
 * assignments (each read through RLS as the signed-in manager) with the shared builders in
 * lib/domain/metrics.ts, so the demo and the server compute the same numbers.
 */
import { buildDirectory, buildRepProfile, type RosterMemberBase, type TeamSessionSummary } from '../lib/domain/metrics.ts';
import type { RpcClient } from './db.ts';
import { ApiError } from './http.ts';

interface Inputs {
  roster: { seatLimit: number; members: RosterMemberBase[]; invitations: unknown[] };
  summaries: { currentRubricVersion: string | null; sessions: TeamSessionSummary[] };
  admin: { assignments: Record<string, string[]> };
}

async function load(db: RpcClient): Promise<Inputs> {
  const [roster, summaries, admin] = await Promise.all([db.rpc<Inputs['roster']>('manager_roster'), db.rpc<Inputs['summaries']>('manager_summaries'), db.rpc<Inputs['admin']>('scenario_admin')]);
  return { roster, summaries, admin };
}

export async function rosterWithDirectory(db: RpcClient) {
  const { roster, summaries, admin } = await load(db);
  return { ...roster, members: buildDirectory({ members: roster.members, sessions: summaries.sessions, assignments: admin.assignments, currentRubricVersion: summaries.currentRubricVersion ?? '' }) };
}

export async function repProfile(db: RpcClient, userId: string) {
  const { roster, summaries, admin } = await load(db);
  const member = roster.members.find((m) => m.userId === userId);
  if (!member) throw new ApiError(404, 'not_found', 'Member not found.');
  return buildRepProfile({ member, sessions: summaries.sessions, assignments: admin.assignments, currentRubricVersion: summaries.currentRubricVersion ?? '', now: new Date() });
}
