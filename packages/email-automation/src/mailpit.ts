import nodemailer, { type Transporter } from 'nodemailer';
import { nanoid } from 'nanoid';
import pino from 'pino';
import type { InboundEmail, OutboundEmail } from '@argo/shared-types';
import type { DeliveryStatus, EmailAutomationService, ListThreadArgs, SendResult } from './service.js';

const log = pino({ name: 'mailpit-service', level: process.env.LOG_LEVEL ?? 'info' });

/**
 * Dev-mode EmailAutomationService backed by Mailpit (localhost:1025 SMTP).
 *
 * Used when AGENTMAIL_ENABLED=false. Inbound webhooks are NOT delivered in
 * dev — instead, Maya's "reply" path is exercised by hitting
 * POST /api/dev/email/inbound directly with a synthesised payload.
 */
export class MailpitService implements EmailAutomationService {
  readonly name = 'mailpit' as const;
  private readonly transporter: Transporter;

  constructor(opts: { host: string; port: number; from: string }) {
    this.transporter = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: false,
      auth: undefined,
      ignoreTLS: true,
    });
    this.from = opts.from;
  }

  private readonly from: string;

  static fromEnv(): MailpitService {
    return new MailpitService({
      host: process.env.MAILPIT_SMTP_HOST ?? 'localhost',
      port: Number.parseInt(process.env.MAILPIT_SMTP_PORT ?? '1025', 10),
      from: process.env.AGENTMAIL_FROM_ADDRESS ?? 'argo-dev@argo.local',
    });
  }

  async send(email: OutboundEmail): Promise<SendResult> {
    const info = await this.transporter.sendMail({
      from: { name: email.from.name ?? 'Argo (dev)', address: this.from },
      replyTo: email.replyTo
        ? { name: email.replyTo.name ?? 'Argo (dev)', address: email.replyTo.email }
        : undefined,
      to: email.to.map((r) => ({ name: r.name ?? '', address: r.email })),
      cc: email.cc.map((r) => ({ name: r.name ?? '', address: r.email })),
      bcc: email.bcc.map((r) => ({ name: r.name ?? '', address: r.email })),
      subject: email.subject,
      text: email.textBody,
      html: email.htmlBody,
      headers: {
        ...email.headers,
        'X-Argo-Email-Id': email.id,
        'X-Argo-Kind': email.kind,
      },
    });
    log.debug({ messageId: info.messageId, to: email.to }, 'mailpit accepted');
    return {
      providerMessageId: info.messageId ?? `mp_${nanoid(16)}`,
      acceptedAt: new Date().toISOString(),
    };
  }

  async listThread(_args: ListThreadArgs): Promise<InboundEmail[]> {
    return [];
  }

  async getDeliveryStatus(providerMessageId: string): Promise<DeliveryStatus | null> {
    return {
      providerMessageId,
      status: 'delivered',
      updatedAt: new Date().toISOString(),
    };
  }

  verifyInboundWebhook(_args: {
    rawBody: string | Buffer;
    headers: Record<string, string | string[] | undefined>;
  }): boolean {
    return true; // dev only — never used in prod
  }

  async parseInboundWebhook(args: {
    rawBody: string | Buffer;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<InboundEmail> {
    const raw = typeof args.rawBody === 'string' ? args.rawBody : args.rawBody.toString('utf8');
    const parsed = JSON.parse(raw) as {
      from?: { name?: string; email?: string };
      to?: Array<{ name?: string; email: string }>;
      subject?: string;
      text?: string;
      html?: string;
      threadId?: string;
      operationId?: string;
      approvalToken?: string;
    };
    return {
      id: `inb_dev_${nanoid(12)}`,
      receivedAt: new Date().toISOString(),
      from: { name: parsed.from?.name, email: parsed.from?.email ?? 'dev@argo.local' },
      to: parsed.to ?? [{ email: 'argoai@agentmail.to' }],
      subject: parsed.subject ?? '(no subject)',
      textBody: parsed.text ?? '',
      htmlBody: parsed.html,
      threadId: parsed.threadId,
      rawHeaders: {},
      attachments: [],
      signatureValid: true,
      routingHint:
        parsed.operationId || parsed.approvalToken
          ? { operationId: parsed.operationId, approvalToken: parsed.approvalToken }
          : undefined,
    };
  }
}
