import { DIMENSION_KEYS, type FeedbackReport, type ManagerReview, type PracticeSession } from '../../lib/domain/types.ts';
import type { Repository } from './repo/types.ts';

/**
 * Manager data export (terms section 13: customers can take their practice data with them).
 * Built in the browser from the same reads the manager screens use, so it only ever contains what
 * this manager can already see, and works the same in the demo and the connected app.
 */
export interface TeamExportSession { session: PracticeSession; reports: FeedbackReport[]; reviews: ManagerReview[] }
export interface TeamExport {
  format: 'pitchready-team-export';
  version: 1;
  exportedAt: string;
  agencyName: string | null;
  retentionDays: number | null;
  sessions: TeamExportSession[];
}

export async function collectTeamExport(repo: Repository, meta: { agencyName: string | null; retentionDays: number | null }, now = new Date()): Promise<TeamExport> {
  const rows = await repo.listTeamSessions();
  const ids = rows.map((r) => r.id);
  const sessions: TeamExportSession[] = new Array(ids.length);
  // A few at a time: fast enough for hundreds of sessions without flooding the server.
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const i = next++;
      const d = await repo.getSession(ids[i]!);
      sessions[i] = { session: d.session, reports: d.reports ?? [], reviews: d.reviews ?? [] };
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));
  return { format: 'pitchready-team-export', version: 1, exportedAt: now.toISOString(), agencyName: meta.agencyName, retentionDays: meta.retentionDays, sessions };
}

/** The text a turn ends up with after any manager corrections (latest revision wins). */
function finalText(s: PracticeSession, turnId: string, original: string): string {
  const c = s.corrections.filter((x) => x.turnId === turnId).sort((a, b) => b.revision - a.revision)[0];
  return c ? c.correctedText : original;
}

/** Spreadsheet apps run cells starting with these as formulas; prefix them so text stays text. */
function cell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per practice session, readable in Excel / Google Sheets. */
export function teamExportCsv(x: TeamExport): string {
  const dims = new Set<string>(DIMENSION_KEYS);
  for (const { session } of x.sessions) {
    const r = latestResult(session);
    for (const d of r?.dimensions ?? []) dims.add(d.key);
  }
  const dimList = [...dims];
  const header = ['Session ID', 'Rep', 'Scenario', 'Drill', 'Campaign', 'Campaign version', 'Rubric', 'Started', 'Ended', 'Status', 'Minutes used',
    ...dimList.map((d) => `Score: ${d.replace(/_/g, ' ')}`), 'Strength', 'To improve', 'Concerns', 'Rep reports', 'Manager notes', 'Transcript'];
  const lines = [header.map(cell).join(',')];
  for (const { session: s, reports, reviews } of x.sessions) {
    const r = latestResult(s);
    const scores = new Map((r?.dimensions ?? []).map((d) => [d.key as string, d.score]));
    const transcript = s.turns.map((t) => `${t.speaker === 'rep' ? 'Rep' : 'Customer'}: ${finalText(s, t.id, t.text)}`).join('\n');
    lines.push([
      s.id, s.repName, s.scenarioTitle ?? s.scenarioKey, s.drillKey ?? '', s.campaignName, s.campaignVersion, s.rubricVersion,
      s.startedAt ?? '', s.endedAt ?? '', s.status, s.usedSeconds == null ? '' : (s.usedSeconds / 60).toFixed(1),
      ...dimList.map((d) => scores.get(d) ?? ''),
      r?.strength?.text ?? '', r?.improvement?.text ?? '',
      (r?.concerns ?? []).map((c) => c.explanation).join('\n'),
      reports.map((p) => `${p.reason.replace(/_/g, ' ')} (${p.status}): ${p.description}`).join('\n'),
      reviews.map((v) => `${v.managerName} (${v.resolution.replace(/_/g, ' ')}): ${v.note}`).join('\n'),
      transcript,
    ].map(cell).join(','));
  }
  // BOM so Excel reads the file as UTF-8 (names, £, curly quotes).
  return '﻿' + lines.join('\r\n') + '\r\n';
}

function latestResult(s: PracticeSession) {
  return [...s.evaluations].filter((e) => e.status === 'completed' && e.result).sort((a, b) => b.transcriptRevision - a.transcriptRevision)[0]?.result ?? null;
}

export function exportFileName(x: TeamExport, ext: 'csv' | 'json'): string {
  const slug = (x.agencyName ?? 'team').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'team';
  return `pitchready-${slug}-${x.exportedAt.slice(0, 10)}.${ext}`;
}

/** Hands a file to the browser's download. */
export function downloadFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
