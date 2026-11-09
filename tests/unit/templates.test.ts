import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SALES_TEMPLATES } from '../../lib/content/templates.ts';
import { DRILLS } from '../../lib/content/scenarios.ts';
import { campaignPackSchema, scenarioInput } from '../../lib/domain/schemas.ts';
import { CHANNEL_INFO, salesContextOf, LEGACY_SALES_CONTEXT } from '../../lib/domain/sales.ts';

test('every sales template is a valid campaign pack with five valid, distinct scenarios', () => {
  assert.ok(SALES_TEMPLATES.length >= 6);
  assert.equal(new Set(SALES_TEMPLATES.map((t) => t.id)).size, SALES_TEMPLATES.length);
  for (const t of SALES_TEMPLATES) {
    const r = campaignPackSchema.safeParse({ ...t.pack, version: 1 });
    assert.ok(r.success, `${t.id}: ${r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3))}`);
    assert.equal(t.pack.sales_context?.channel, t.channel, t.id);
    assert.ok(t.pack.fictional, `${t.id} must be fictional`);
    assert.equal(t.scenarios.length, 5, t.id);
    assert.equal(new Set(t.scenarios.map((s) => s.title)).size, 5, `${t.id} titles unique`);
    for (const s of t.scenarios) {
      const v = scenarioInput.safeParse({ ...s, key: null });
      assert.ok(v.success, `${t.id} / ${s.title}: ${v.success ? '' : JSON.stringify(v.error.issues.slice(0, 2))}`);
    }
  }
});

test('sales setting: packs without one are door-to-door fundraising; unknown channels become "other"', () => {
  assert.deepEqual(salesContextOf({}), LEGACY_SALES_CONTEXT);
  const c = salesContextOf({ sales_context: { channel: 'carrier-pigeon' as never, offer: ' ', customer_label: 'Client', good_outcome: '' } });
  assert.equal(c.channel, 'other'); assert.equal(c.customer_label, 'client'); assert.equal(c.offer, 'the offer');
  for (const info of Object.values(CHANNEL_INFO)) assert.ok(info.label && info.scene && info.short);
});

test('retry drill openers in the latest migration match lib/content/scenarios.ts', () => {
  const dir = 'supabase/migrations';
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const latest = files.filter((f) => readFileSync(`${dir}/${f}`, 'utf8').includes('function app_private.drill_opener')).at(-1)!;
  const sql = readFileSync(`${dir}/${latest}`, 'utf8');
  for (const d of DRILLS) {
    const m = sql.match(new RegExp(`when '${d.key}' then '((?:[^']|'')*)'`));
    assert.ok(m, `${d.key} missing in ${latest}`);
    assert.equal(m![1]!.replace(/''/g, "'"), d.opener, d.key);
  }
});
