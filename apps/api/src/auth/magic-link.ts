import { generateMagicLinkToken, hashToken } from '@argo/security';
import { getPrisma } from '../db/prisma.js';
import { getConfig } from '../config.js';
import { renderMagicLinkEmail, toOutboundEmail } from '@argo/email-automation';
import { createEmailAutomationService } from '@argo/email-automation';
import { nanoid } from 'nanoid';

const emailService = createEmailAutomationService();

export async function issueMagicLink(args: { email: string }): Promise<{ token: string; userId: string }> {
  const cfg = getConfig();
  const normalised = args.email.trim().toLowerCase();

  if (cfg.AUTH_ALLOWED_DOMAINS !== '*') {
    const allowed = cfg.AUTH_ALLOWED_DOMAINS.split(',').map((s) => s.trim().toLowerCase());
    const domain = normalised.split('@')[1] ?? '';
    if (!allowed.includes(domain)) {
      throw new Error('email_domain_not_allowed');
    }
  }

  const user = await getPrisma().user.upsert({
    where: { email: normalised },
    update: {},
    create: { email: normalised, name: null },
  });

  const { plaintext, hash } = generateMagicLinkToken();
  const expiresAt = new Date(Date.now() + cfg.AUTH_MAGIC_LINK_TTL_SECONDS * 1000);

  await getPrisma().magicLink.create({
    data: { userId: user.id, tokenHash: hash, expiresAt },
  });

  const loginUrl = `${cfg.API_PUBLIC_URL}/auth/magic-callback?token=${encodeURIComponent(plaintext)}`;
  const rendered = renderMagicLinkEmail({
    recipientFirstName: user.name?.split(' ')[0] ?? 'there',
    loginUrl,
    expiresInMinutes: Math.round(cfg.AUTH_MAGIC_LINK_TTL_SECONDS / 60),
  });

  await emailService.send(
    toOutboundEmail({
      id: 'eml_' + nanoid(12),
      operationId: null,
      kind: 'magic_link',
      from: { name: 'Argo', email: process.env.AGENTMAIL_FROM_ADDRESS ?? 'argoai@agentmail.to' },
      to: [{ email: normalised }],
      rendered,
    }),
  );

  return { token: plaintext, userId: user.id };
}

export async function consumeMagicLink(plaintext: string): Promise<{ userId: string } | null> {
  const tokenHash = hashToken(plaintext);
  const link = await getPrisma().magicLink.findUnique({ where: { tokenHash } });
  if (!link) return null;
  if (link.consumedAt) return null;
  if (link.expiresAt.getTime() < Date.now()) return null;

  await getPrisma().magicLink.update({
    where: { id: link.id },
    data: { consumedAt: new Date() },
  });
  await getPrisma().user.update({
    where: { id: link.userId },
    data: { lastLoginAt: new Date() },
  });
  return { userId: link.userId };
}
