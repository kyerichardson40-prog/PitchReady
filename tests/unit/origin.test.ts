import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSameOrigin, requestOrigin } from '../../server/http.ts';

const post = (url: string, headers: Record<string, string>) => new Request(url, { method: 'POST', headers });

test('origin check: the configured address or the address actually used; never another site', () => {
  process.env.APP_BASE_URL = 'https://live.example.app';
  // Configured address.
  assertSameOrigin(post('http://internal:3000/api/contact', { origin: 'https://live.example.app' }));
  // A stale APP_BASE_URL no longer locks out the site the browser is really on (behind a proxy).
  const preview = post('http://internal:3000/api/contact', { origin: 'https://preview.example.app', 'x-forwarded-host': 'preview.example.app', 'x-forwarded-proto': 'https' });
  assert.equal(requestOrigin(preview), 'https://preview.example.app');
  assertSameOrigin(preview);
  // A different site is still refused, whatever the host.
  assert.throws(() => assertSameOrigin(post('http://internal:3000/api/contact', { origin: 'https://evil.example', 'x-forwarded-host': 'preview.example.app', 'x-forwarded-proto': 'https' })), /origin not allowed/);
  // http vs https mismatch is refused.
  assert.throws(() => assertSameOrigin(post('http://internal:3000/api/contact', { origin: 'http://preview.example.app', 'x-forwarded-host': 'preview.example.app', 'x-forwarded-proto': 'https' })), /origin not allowed/);
});
