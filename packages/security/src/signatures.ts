import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Webhook signature verification.
 *
 * Section 12: "Webhook signature verification mandatory on every inbound
 * endpoint. Unsigned webhooks return 401."
 *
 * The signature scheme is HMAC-SHA256 over `${timestamp}.${rawBody}`,
 * matching the Stripe-style format AgentMail uses. Window is 5 minutes by
 * default to defeat replay attacks.
 */

export type SignatureCheckArgs = {
  rawBody: string | Buffer;
  signatureHeader: string | undefined;
  timestampHeader: string | undefined;
  secret: string;
  toleranceSeconds?: number;
};

export type SignatureCheckResult =
  | { valid: true }
  | { valid: false; reason: 'missing_headers' | 'malformed' | 'expired' | 'mismatch' };

export function verifyWebhookSignature(args: SignatureCheckArgs): SignatureCheckResult {
  if (!args.signatureHeader || !args.timestampHeader || !args.secret) {
    return { valid: false, reason: 'missing_headers' };
  }

  const tolerance = args.toleranceSeconds ?? 300;
  const ts = Number.parseInt(args.timestampHeader, 10);
  if (!Number.isFinite(ts) || ts <= 0) {
    return { valid: false, reason: 'malformed' };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - ts) > tolerance) {
    return { valid: false, reason: 'expired' };
  }

  const payload = `${args.timestampHeader}.${typeof args.rawBody === 'string' ? args.rawBody : args.rawBody.toString('utf8')}`;
  const expected = createHmac('sha256', args.secret).update(payload).digest('hex');

  const received = parseSignatureHeader(args.signatureHeader);
  if (!received) {
    return { valid: false, reason: 'malformed' };
  }

  const expectedBuf = Buffer.from(expected, 'hex');
  const receivedBuf = Buffer.from(received, 'hex');
  if (expectedBuf.length !== receivedBuf.length) {
    return { valid: false, reason: 'mismatch' };
  }

  return timingSafeEqual(expectedBuf, receivedBuf) ? { valid: true } : { valid: false, reason: 'mismatch' };
}

function parseSignatureHeader(value: string): string | null {
  // Accept both raw hex and `v1=hex` form.
  const trimmed = value.trim();
  const eq = trimmed.indexOf('=');
  if (eq === -1) {
    return /^[a-f0-9]{64}$/i.test(trimmed) ? trimmed.toLowerCase() : null;
  }
  const candidate = trimmed.slice(eq + 1).trim();
  return /^[a-f0-9]{64}$/i.test(candidate) ? candidate.toLowerCase() : null;
}

export function signWebhookPayload(secret: string, payload: string, timestampSeconds?: number): {
  signature: string;
  timestamp: string;
} {
  const ts = String(timestampSeconds ?? Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
  return { signature, timestamp: ts };
}
