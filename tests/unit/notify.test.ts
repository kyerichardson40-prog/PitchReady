import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contactEmail, notifyContact } from '../../server/services/notify.ts';

const fields = {
  name: 'Sam\r\nBcc: evil@example.org',
  email: 'sam@example.org',
  company: 'Example Co',
  team_size: '6–20 reps',
  sales_type: 'Events',
  message: 'Hello,\nplease get in touch.',
};

test('contact email: subject stays on one line, body is plain text with the details', () => {
  const { subject, text } = contactEmail(fields);
  assert.ok(!/[\r\n]/.test(subject));
  assert.match(subject, /^New PitchReady enquiry from Sam Bcc: evil@example\.org \(Example Co\)$/);
  assert.match(text, /Email: sam@example\.org/);
  assert.match(text, /Sales type: Events/);
  assert.match(text, /Hello,\nplease get in touch\./);
});

test('notify: skipped quietly when not configured', async () => {
  let called = false;
  const fetchImpl = (async () => { called = true; return new Response('{}'); }) as typeof fetch;
  assert.equal(await notifyContact(fields, { env: {}, fetchImpl }), 'skipped');
  assert.equal(await notifyContact(fields, { env: { RESEND_API_KEY: 're_x' }, fetchImpl }), 'skipped');
  assert.equal(called, false);
});

test('notify: posts to Resend with reply-to set to the sender', async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const fetchImpl = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response('{"id":"1"}', { status: 200 }); }) as unknown as typeof fetch;
  const r = await notifyContact(fields, { env: { RESEND_API_KEY: 're_test', CONTACT_NOTIFY_EMAIL: 'owner@example.org' }, fetchImpl });
  assert.equal(r, 'sent');
  assert.equal(seen!.url, 'https://api.resend.com/emails');
  assert.equal((seen!.init.headers as Record<string, string>).Authorization, 'Bearer re_test');
  const body = JSON.parse(String(seen!.init.body));
  assert.deepEqual(body.to, ['owner@example.org']);
  assert.equal(body.reply_to, 'sam@example.org');
  assert.equal(body.from, 'PitchReady <onboarding@resend.dev>');
  assert.equal(body.html, undefined);
});

test('notify: a failed or thrown request reports failed and never throws', async () => {
  const env = { RESEND_API_KEY: 're_test', CONTACT_NOTIFY_EMAIL: 'owner@example.org' };
  const orig = console.error; console.error = () => {};
  try {
    assert.equal(await notifyContact(fields, { env, fetchImpl: (async () => new Response('no', { status: 403 })) as typeof fetch }), 'failed');
    assert.equal(await notifyContact(fields, { env, fetchImpl: (async () => { throw new Error('down'); }) as typeof fetch }), 'failed');
  } finally { console.error = orig; }
});
