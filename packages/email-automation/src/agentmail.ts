import { request } from 'undici';
import { nanoid } from 'nanoid';
import pino from 'pino';
import { verifyWebhookSignature } from '@argo/security';
import type { InboundEmail, OutboundEmail } from '@argo/shared-types';
import type {
  DeliveryStatus,
  EmailAutomationService,
  ListThreadArgs,
  SendResult,
} from './service.js';

const log = pino({ name: 'agentmail-service', level: process.env.LOG_LEVEL ?? 'info' });

export type AgentMailConfig = {
  apiKey: string;
  apiBase: string;
  fromAddress: string;
  inboundWebhookSecret: string;
  replyDomain: string;
};

/**
 * AgentMailService — production EmailAutomationService.
 *
 * Outbound: POST {apiBase}/v1/messages with the JSON OutboundEmail.
 * Inbound:  webhook signed with HMAC-SHA256 over `${ts}.${rawBody}`.
 *
 * The wire format follows the AgentMail llms-full.txt reference. Where the
 * actual schema differs, the adapter normalises to Argo's InboundEmail/
 * OutboundEmail. The module is intentionally thin — no business logic, just
 * transport.
 */
export class AgentMailService implements EmailAutomationService {
  readonly name = 'agentmail' as const;

  constructor(private readonly cfg: AgentMailConfig) {
    if (!cfg.apiKey) throw new Error('AgentMailConfig: apiKey is required');
    if (!cfg.fromAddress) throw new Error('AgentMailConfig: fromAddress is required');
  }

  static fromEnv(): AgentMailService {
    return new AgentMailService({
      apiKey: process.env.AGENTMAIL_API_KEY ?? '',
      apiBase: process.env.AGENTMAIL_API_BASE ?? 'https://api.agentmail.to',
      fromAddress: process.env.AGENTMAIL_FROM_ADDRESS ?? 'argoai@agentmail.to',
      inboundWebhookSecret: process.env.AGENTMAIL_INBOUND_WEBHOOK_SECRET ?? '',
      replyDomain: process.env.AGENTMAIL_REPLY_DOMAIN ?? 'agentmail.to',
    });
  }

  async send(email: OutboundEmail): Promise<SendResult> {
    const body = {
      from: this.cfg.fromAddress,
      reply_to: email.replyTo?.email ?? `reply+${email.id}@${this.cfg.replyDomain}`,
      to: email.to.map((r) => ({ name: r.name, email: r.email })),
      cc: email.cc.map((r) => ({ name: r.name, email: r.email })),
      bcc: email.bcc.map((r) => ({ name: r.name, email: r.email })),
      subject: email.subject,
      text: email.textBody,
      html: email.htmlBody,
      headers: {
        ...email.headers,
        'X-Argo-Email-Id': email.id,
        'X-Argo-Kind': email.kind,
      },
      metadata: {
        argo_email_id: email.id,
        argo_operation_id: email.operationId ?? '',
        argo_kind: email.kind,
        ...email.metadata,
      },
      attachments: email.attachments.map((a) => ({
        filename: a.filename,
        content_type: a.contentType,
        content_base64: a.contentBase64,
        url: a.url,
      })),
    };

    const res = await request(`${this.cfg.apiBase}/v1/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.cfg.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await res.body.text();
    if (res.statusCode >= 400) {
      log.error({ statusCode: res.statusCode, text }, 'agentmail send failed');
      throw new Error(`AgentMail send failed: HTTP ${res.statusCode}`);
    }
    let parsed: { id?: string; created_at?: string } = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      // Non-JSON success body — accept and synthesise.
    }
    return {
      providerMessageId: parsed.id ?? `am_${nanoid(16)}`,
      acceptedAt: parsed.created_at ?? new Date().toISOString(),
    };
  }

  async listThread(_args: ListThreadArgs): Promise<InboundEmail[]> {
    return [];
  }

  async getDeliveryStatus(providerMessageId: string): Promise<DeliveryStatus | null> {
    const res = await request(`${this.cfg.apiBase}/v1/messages/${providerMessageId}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${this.cfg.apiKey}` },
    });
    if (res.statusCode === 404) {
      await res.body.dump();
      return null;
    }
    const text = await res.body.text();
    if (res.statusCode >= 400) {
      log.warn({ statusCode: res.statusCode, text }, 'agentmail status fetch failed');
      return null;
    }
    let parsed: { status?: string; updated_at?: string } = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    return {
      providerMessageId,
      status: normaliseDeliveryStatus(parsed.status),
      updatedAt: parsed.updated_at ?? new Date().toISOString(),
    };
  }

  verifyInboundWebhook(args: {
    rawBody: string | Buffer;
    headers: Record<string, string | string[] | undefined>;
  }): boolean {
    if (!this.cfg.inboundWebhookSecret) return false;
    const signatureHeader = headerValue(args.headers, 'x-agentmail-signature');
    const timestampHeader = headerValue(args.headers, 'x-agentmail-timestamp');
    return verifyWebhookSignature({
      rawBody: args.rawBody,
      signatureHeader,
      timestampHeader,
      secret: this.cfg.inboundWebhookSecret,
    }).valid;
  }

  async parseInboundWebhook(args: {
    rawBody: string | Buffer;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<InboundEmail> {
    const valid = this.verifyInboundWebhook(args);
    const raw = typeof args.rawBody === 'string' ? args.rawBody : args.rawBody.toString('utf8');
    let body: AgentMailInboundPayload;
    try {
      body = JSON.parse(raw) as AgentMailInboundPayload;
    } catch (err) {
      throw new Error(`AgentMail inbound webhook is not JSON: ${String(err)}`);
    }

    return {
      id: body.message?.id ?? `inb_${nanoid(16)}`,
      receivedAt: body.message?.received_at ?? new Date().toISOString(),
      from: { name: body.message?.from?.name, email: body.message?.from?.email ?? 'unknown@unknown' },
      to: (body.message?.to ?? []).map((r) => ({ name: r.name, email: r.email })),
      subject: body.message?.subject ?? '(no subject)',
      textBody: body.message?.text ?? '',
      htmlBody: body.message?.html,
      inReplyToMessageId: body.message?.in_reply_to,
      threadId: body.message?.thread_id,
      rawHeaders: body.message?.headers ?? {},
      attachments: (body.message?.attachments ?? []).map((a) => ({
        filename: a.filename,
        contentType: a.content_type,
        size: a.size ?? 0,
        url: a.url,
      })),
      signatureValid: valid,
      routingHint: extractRoutingHint(body),
    };
  }
}

type AgentMailInboundPayload = {
  message?: {
    id?: string;
    received_at?: string;
    from?: { name?: string; email?: string };
    to?: Array<{ name?: string; email: string }>;
    subject?: string;
    text?: string;
    html?: string;
    in_reply_to?: string;
    thread_id?: string;
    headers?: Record<string, string>;
    attachments?: Array<{
      filename: string;
      content_type: string;
      size?: number;
      url?: string;
    }>;
    metadata?: Record<string, string>;
  };
};

function extractRoutingHint(body: AgentMailInboundPayload): InboundEmail['routingHint'] | undefined {
  const meta = body.message?.metadata ?? {};
  const operationId = meta.argo_operation_id;
  const approvalToken = meta.argo_approval_token;
  if (!operationId && !approvalToken) return undefined;
  return {
    operationId: operationId ?? undefined,
    approvalToken: approvalToken ?? undefined,
  };
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function normaliseDeliveryStatus(value: string | undefined): DeliveryStatus['status'] {
  switch ((value ?? '').toLowerCase()) {
    case 'queued':
    case 'sent':
    case 'delivered':
    case 'bounced':
    case 'complained':
      return value as DeliveryStatus['status'];
    default:
      return 'unknown';
  }
}
