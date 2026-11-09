import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectTeamExport, exportFileName, teamExportCsv, type TeamExport } from '../../src/client/team-export.ts';

const session: any = {
  id: 's1', repId: 'r1', repName: 'Sam, "the closer"', kind: 'full', scenarioKey: 'busy', scenarioTitle: 'Busy parent', drillKey: null, parentSessionId: null,
  campaignVersion: 2, campaignName: 'BrightLine', rubricVersion: 'v1', mode: 'connected', status: 'ended', evaluationStatus: 'completed',
  startedAt: '2026-11-09T10:00:00Z', deadlineAt: null, endedAt: '2026-11-09T10:03:00Z', endReason: 'rep_ended', transcriptRevision: 1, usedSeconds: 150,
  turns: [
    { id: 'resident-1', sequence: 1, speaker: 'resident', text: 'Hello?', source: 'generated', createdAt: '' },
    { id: 'rep-2', sequence: 2, speaker: 'rep', text: 'Hi, I am from Brigthline', source: 'transcribed', createdAt: '' },
    { id: 'rep-3', sequence: 3, speaker: 'rep', text: '=HYPERLINK("http://x")', source: 'typed', createdAt: '' },
  ],
  corrections: [{ turnId: 'rep-2', revision: 1, correctedText: 'Hi, I am from BrightLine', correctedBy: 'M', createdAt: '' }],
  evaluations: [{ id: 'e1', transcriptRevision: 1, evaluatorKind: 'mock', model: null, promptVersion: 'p', status: 'completed', createdAt: '',
    result: { schema_version: '1.1', rubric_version: 'v1', transcript_revision: 1, dimensions: [{ key: 'introduction', score: 4, reason: '', evidence: [] }],
      strength: { text: 'Clear intro', turn_ids: [] }, improvement: { text: 'Ask a question', turn_ids: [] }, concerns: [], retry: null, limitations: [] } }],
};
const x: TeamExport = { format: 'pitchready-team-export', version: 1, exportedAt: '2026-11-09T12:00:00.000Z', agencyName: "Kye's Test Agency", retentionDays: 30,
  sessions: [{ session, reports: [], reviews: [{ id: 'v', sessionId: 's1', managerId: 'm', managerName: 'Kye', note: 'Good start', resolution: 'noted', createdAt: '' }] }] };

test('team export CSV: one row per session, corrected transcript, quoting and formula safety', () => {
  const csv = teamExportCsv(x);
  assert.ok(csv.startsWith('﻿Session ID,Rep,'));
  const [header, row] = csv.slice(1).split('\r\n');
  assert.match(header!, /Score: introduction/);
  assert.match(row!, /^s1,"Sam, ""the closer""",Busy parent,/);
  assert.match(row!, /Customer: Hello\?\nRep: Hi, I am from BrightLine\nRep: =HYPERLINK/);
  assert.match(row!, /,2\.5,4,,,,,Clear intro,Ask a question,/);
  assert.match(row!, /Kye \(noted\): Good start/);
  assert.match(row!, /,2\.5,/);
  // A cell that *starts* with = is neutralised.
  const y = { ...x, sessions: [{ ...x.sessions[0]!, session: { ...session, repName: '=cmd' } }] };
  assert.match(teamExportCsv(y).split('\r\n')[1]!, /^s1,'=cmd,/);
});

test('team export: file name and collection through the repository', async () => {
  assert.equal(exportFileName(x, 'csv'), 'pitchready-kye-s-test-agency-2026-11-09.csv');
  const calls: string[] = [];
  const repo: any = {
    listTeamSessions: async () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    getSession: async (id: string) => { calls.push(id); return { session: { ...session, id }, reports: [], reviews: [] }; },
  };
  const out = await collectTeamExport(repo, { agencyName: 'A', retentionDays: 30 }, new Date('2026-11-09T00:00:00Z'));
  assert.deepEqual(out.sessions.map((s) => s.session.id), ['a', 'b', 'c']);
  assert.equal(calls.length, 3);
  assert.equal(out.exportedAt, '2026-11-09T00:00:00.000Z');
});
