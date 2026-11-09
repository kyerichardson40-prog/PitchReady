import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getConfig, connectedReady } from '../../server/config.ts';
import { DRILLS } from '../../lib/content/scenarios.ts';
import { computeOverview } from '../../lib/domain/metrics.ts';

test('SQL drill scenario mapping matches lib/content (openers: tests/unit/templates.test.ts)', () => {
  const sql = readFileSync('supabase/migrations/20261106000300_api.sql', 'utf8');
  for (const d of DRILLS) {
    assert.ok(sql.includes(`when '${d.key}' then '${d.baseScenario}'`) || sql.includes(`'${d.key}' then '${d.baseScenario}'`), `scenario for ${d.key}`);
  }
});

test('config: live AI stays disabled until keys, models, rate card and budgets are all set', () => {
  const c = getConfig({ APP_MODE: 'connected', LIVE_AI_ENABLED: 'true', ANTHROPIC_API_KEY: 'x' } as any, true);
  assert.equal(c.liveAi, false);
  assert.ok(c.problems.some((p) => p.includes('Live AI stays disabled')));
  assert.equal(connectedReady(c), false, 'missing Supabase/maintenance config fails closed');
});

test('config: demo cannot be production; mock provider refused in production; NEXT_PUBLIC secrets flagged', () => {
  assert.ok(getConfig({ APP_MODE: 'demo', NODE_ENV: 'production' } as any, true).problems.some((p) => /demo cannot run/.test(p)));
  const m = getConfig({ APP_MODE: 'connected', NODE_ENV: 'production', AI_PROVIDER: 'mock' } as any, true);
  assert.equal(m.providerKind, 'none');
  assert.ok(getConfig({ APP_MODE: 'demo', NEXT_PUBLIC_ANTHROPIC_API_KEY: 'x' } as any, true).problems.some((p) => /NEXT_PUBLIC_ANTHROPIC_API_KEY/.test(p)));
});

test('metrics: absent scores are not zero; small samples flagged; other rubric versions not combined', () => {
  const s = (id: string, rep: string, rubric: string, intro: number | null) => ({ id, repId: rep, status: 'ended' as const, evaluationStatus: 'completed' as const, endedAt: new Date().toISOString(), usedSeconds: 60, rubricVersion: rubric, scores: { introduction: intro, accuracy: null }, openConcerns: 0, openReports: 0 });
  const o = computeOverview({ sessions: [s('1', 'a', 'v1', 4), s('2', 'a', 'v1', null), s('3', 'b', 'v1', 2), s('4', 'b', 'v0', 1)], activeRepIds: ['a', 'b', 'c'], periodDays: 7, now: new Date(), currentRubricVersion: 'v1' });
  const intro = o.breakdown.find((d) => d.key === 'introduction')!;
  assert.equal(intro.observed, 2);
  assert.equal(intro.notObserved, 1);
  assert.equal(intro.mean, 3);
  assert.equal(intro.enoughData, false);
  assert.deepEqual(o.excludedOtherRubric, [{ version: 'v0', sessions: 1 }]);
  assert.equal(o.activeReps, 3);
  assert.equal(o.repsWithCompleted, 2);
});
