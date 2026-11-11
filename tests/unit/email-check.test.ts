/** Throwaway email check for free pilots (D46). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDisposableEmail } from '../../lib/domain/email-check.ts';
import { DISPOSABLE_DOMAINS } from '../../lib/content/disposable-domains.ts';

test('temporary inboxes are caught, including subdomains and odd casing; normal providers and work addresses are not', () => {
  for (const e of ['someone@mailinator.com', 'x@10minutemail.com', 'Bob@GuerrillaMail.com', 'a@inbox.mailinator.com']) assert.equal(isDisposableEmail(e, DISPOSABLE_DOMAINS), true, e);
  for (const e of ['kye.pitchready@gmail.com', 'a@outlook.com', 'a@hotmail.co.uk', 'a@icloud.com', 'a@yahoo.co.uk', 'a@proton.me', 'sam@acme-fundraising.co.uk', 'x@btinternet.com']) assert.equal(isDisposableEmail(e, DISPOSABLE_DOMAINS), false, e);
});
