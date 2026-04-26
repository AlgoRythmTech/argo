import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getPrisma } from '../db/prisma.js';
import { getConfig } from '../config.js';

const SESSION_BYTES = 32;

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export type SessionContext = {
  sessionId: string;
  userId: string;
  email: string;
  expiresAt: Date;
};

export async function createSession(args: {
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<{ token: string; session: SessionContext }> {
  const cfg = getConfig();
  const plaintext = base64UrlEncode(randomBytes(SESSION_BYTES));
  const tokenHash = sha256Hex(plaintext);
  const expiresAt = new Date(Date.now() + cfg.AUTH_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  const created = await getPrisma().session.create({
    data: {
      userId: args.userId,
      tokenHash,
      expiresAt,
      ipAddress: args.ipAddress ?? null,
      userAgent: args.userAgent ?? null,
    },
    include: { user: { select: { email: true } } },
  });

  return {
    token: plaintext,
    session: {
      sessionId: created.id,
      userId: created.userId,
      email: created.user.email,
      expiresAt: created.expiresAt,
    },
  };
}

export async function resolveSession(plaintext: string | undefined): Promise<SessionContext | null> {
  if (!plaintext) return null;
  const tokenHash = sha256Hex(plaintext);
  const session = await getPrisma().session.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, email: true } } },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;

  // Best-effort touch (don't await heavily).
  getPrisma()
    .session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
    .catch(() => {});

  return {
    sessionId: session.id,
    userId: session.user.id,
    email: session.user.email,
    expiresAt: session.expiresAt,
  };
}

export async function destroySession(sessionId: string): Promise<void> {
  await getPrisma().session.delete({ where: { id: sessionId } }).catch(() => {});
}

export function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
