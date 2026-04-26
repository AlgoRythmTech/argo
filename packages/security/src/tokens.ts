import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * One-time approval-link tokens.
 *
 * Section 8, Doctrine 2:
 *   "The approval link is a one-time tokenized URL that resolves the action
 *    without login and expires in 72 hours."
 *
 * Tokens are 32 random bytes encoded as URL-safe base64 (43 chars). Stored
 * server-side as a sha256 hash so a database compromise does not yield live
 * tokens. Resolution is constant-time.
 */

const TOKEN_BYTES = 32;
export const APPROVAL_TOKEN_TTL_SECONDS = 72 * 60 * 60;
export const REMINDER_AT_SECONDS = 48 * 60 * 60;

export type ApprovalTokenPair = {
  /** The plaintext token to embed in the URL. Never store this. */
  plaintext: string;
  /** The sha256 hex digest to store in the database. */
  hash: string;
};

export function generateApprovalToken(): ApprovalTokenPair {
  const bytes = randomBytes(TOKEN_BYTES);
  const plaintext = base64UrlEncode(bytes);
  const hash = sha256Hex(plaintext);
  return { plaintext, hash };
}

export function hashToken(plaintext: string): string {
  return sha256Hex(plaintext);
}

export function tokensMatch(plaintext: string, expectedHash: string): boolean {
  if (!plaintext || !expectedHash) return false;
  const candidate = Buffer.from(sha256Hex(plaintext), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Magic-link tokens. Same primitive, different purpose. TTL is 15 min.
 */
export const MAGIC_LINK_TTL_SECONDS = 15 * 60;

export function generateMagicLinkToken(): ApprovalTokenPair {
  return generateApprovalToken();
}
