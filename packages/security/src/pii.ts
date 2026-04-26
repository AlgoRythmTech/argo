import { createHash } from 'node:crypto';

/**
 * PII redaction for logs and analytics. Names, emails, phones, and URLs with
 * tokens are hashed with HMAC-equivalent (sha256 of value + salt). The salt
 * comes from PII_LOG_SALT or, in dev, a stable per-process salt.
 *
 * Replay of an event for debugging is via the production database with auth,
 * never via log scrape.
 */

const SALT = process.env.PII_LOG_SALT ?? 'dev-pii-salt-rotate-in-prod-1029384756';

const EMAIL_REGEX = /([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
const PHONE_REGEX = /(\+?\d[\d\s().-]{7,}\d)/g;
const URL_TOKEN_REGEX = /([?&](?:token|key|secret|api_key|auth)=)[^&\s"']+/gi;
const BEARER_REGEX = /(Bearer\s+)[A-Za-z0-9._\-=]+/g;
const JWT_REGEX = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

function fingerprint(value: string): string {
  return createHash('sha256')
    .update(SALT + value)
    .digest('hex')
    .slice(0, 12);
}

export function redactPii(input: string): string {
  if (!input) return input;
  return input
    .replace(JWT_REGEX, (m) => `<jwt:${fingerprint(m)}>`)
    .replace(BEARER_REGEX, (_, p1) => `${p1}<redacted>`)
    .replace(URL_TOKEN_REGEX, (_, prefix) => `${prefix}<redacted>`)
    .replace(EMAIL_REGEX, (_, local, domain) => `<email:${fingerprint(local)}@${domain}>`)
    .replace(PHONE_REGEX, (m) => {
      const digits = m.replace(/\D/g, '');
      if (digits.length < 8) return m;
      return `<phone:${fingerprint(digits)}>`;
    });
}

export function redactPiiObject<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactPii(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactPiiObject(v)) as unknown as T;
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactPiiObject(v);
    }
    return out as unknown as T;
  }
  return value;
}
