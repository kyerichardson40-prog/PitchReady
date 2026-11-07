import { createHash, randomBytes } from 'node:crypto';

/** 256-bit random invitation token, URL-safe. Only its SHA-256 is stored. */
export function newInvitationToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
