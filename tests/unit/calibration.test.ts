import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

test('20+ calibration fixtures with declared expectations exist', () => {
  const { fixtures } = JSON.parse(readFileSync('fixtures/calibration/fixtures.json', 'utf8'));
  assert.ok(fixtures.length >= 20);
  for (const f of fixtures) {
    assert.ok(Array.isArray(f.expected_concerns) && f.human_review_note && f.turns.every((t: any) => /^(rep|resident)-\d+$/.test(t.id)), f.case);
  }
  assert.ok(fixtures.some((f: any) => f.complete) && fixtures.some((f: any) => !f.complete), 'complete and partial sessions');
});

test('calibration command (demo rules) produces a schema-valid report', () => {
  const out = execFileSync(process.execPath, ['scripts/calibrate.ts'], { encoding: 'utf8' });
  assert.match(out, /schema failures 0/);
});
