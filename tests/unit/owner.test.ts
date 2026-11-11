import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOwner, ownerEmails } from '../../server/owner.ts';
import { bootstrapPayload } from '../../lib/content/bootstrap-payload.ts';
import { getTemplate } from '../../lib/content/templates.ts';
import { SCENARIOS } from '../../lib/content/scenarios.ts';

test('owner: only confirmed sign-ins whose email is listed, case-insensitively', () => {
  const env = { OWNER_EMAILS: ' Kye@Example.com , second@example.com,,' };
  assert.deepEqual(ownerEmails(env), ['kye@example.com', 'second@example.com']);
  assert.equal(isOwner({ email: 'kye@example.com', emailConfirmed: true }, env), true);
  assert.equal(isOwner({ email: 'KYE@example.com', emailConfirmed: true }, env), true);
  assert.equal(isOwner({ email: 'kye@example.com', emailConfirmed: false }, env), false, 'unconfirmed email');
  assert.equal(isOwner({ email: 'someone@example.com', emailConfirmed: true }, env), false);
  assert.equal(isOwner({ email: 'kye@example.com', emailConfirmed: true }, {}), false, 'nobody is owner until OWNER_EMAILS is set');
  assert.equal(isOwner(null, env), false);
});

test('owner-created teams can start from any kind of selling, keeping the built-in scenario keys', () => {
  const t = getTemplate('telesales')!;
  const p = bootstrapPayload({ agencyName: 'A', managerEmail: 'a@x.invalid', template: t });
  assert.equal(p.campaign.name, t.pack.name);
  assert.equal(p.campaign.version, 1);
  assert.deepEqual(p.scenarios.map((s) => s.key), SCENARIOS.map((s) => s.key));
  assert.equal(p.scenarios[0]!.title, t.scenarios[0]!.title);
  assert.deepEqual(bootstrapPayload({ agencyName: 'A', managerEmail: 'a@x.invalid' }).scenarios, SCENARIOS);
});
