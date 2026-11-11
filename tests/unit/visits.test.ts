/** Site visits (D47): what gets stored is only a tidy page path and a source host. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBot, normalizePath, sourceFromReferrer } from '../../lib/domain/visits.ts';

test('paths are tidied: no query strings, ids or invitation tokens', () => {
  assert.equal(normalizePath('/pricing?utm=x#top'), '/pricing');
  assert.equal(normalizePath('/manager/reps/3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90'), '/manager/reps/:id');
  assert.equal(normalizePath('/invite/abcDEF123_secret-token'), '/invite/:token');
  assert.equal(normalizePath('/about/'), '/about');
  assert.equal(normalizePath('/'), '/');
  assert.equal(normalizePath('https://evil.example/x'), null);
  assert.equal(normalizePath('//evil.example'), null);
  assert.equal(normalizePath('/<script>'), null);
});

test('sources are the linking site’s host; own site and direct visits are blank', () => {
  assert.equal(sourceFromReferrer('https://www.google.com/search?q=pitchready', 'pitchready.app'), 'google.com');
  assert.equal(sourceFromReferrer('https://l.facebook.com/l.php?u=x', 'pitchready.app'), 'facebook.com');
  assert.equal(sourceFromReferrer('https://pitchready.app/pricing', 'pitchready.app'), '');
  assert.equal(sourceFromReferrer('', 'pitchready.app'), '');
  assert.equal(sourceFromReferrer('not a url', 'pitchready.app'), '');
});

test('crawlers and link previewers are not counted; browsers are', () => {
  assert.equal(isBot('WhatsApp/2.23.20.0'), true);
  assert.equal(isBot('facebookexternalhit/1.1'), true);
  assert.equal(isBot('Mozilla/5.0 (compatible; Googlebot/2.1)'), true);
  assert.equal(isBot(''), true);
  assert.equal(isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'), false);
});
