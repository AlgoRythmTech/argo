// argo:upstream agentmail-to/agentmail-typescript@0.4.20 — uses the official
// `agentmail` SDK and `svix` for webhook signature verification.
import { AgentMailClient } from 'agentmail';
import { Webhook } from 'svix';
import { nanoid } from 'nanoid';
import pino from 'pino';
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
  /** The inbox address Argo sends from. Must already exist in AgentMail. */
  fromInboxId: string;
  /** Svix webhook signing secret (starts with `whsec_`). */
  inboundWebhookSecret: string;
  /** Domain on which Argo's reply addresses are routed (e.g. agentmail.to). */
  replyDomain: string;
};

/**
 * AgentMailService — production EmailAutomationService backed by the official
 * agentmail SDK. Outbound calls hit `client.inboxes.messages.send()`. Inbound
 * webhook verification uses the Svix library (AgentMail delivers via Svix).
 */
export class AgentMailService implements EmailAutomationService {
  readonly name = 'agentmail' as const;
  private readonly client: AgentMailClient;
  private readonly webhook: Webhook | null;

  constructor(private readonly cfg: AgentMailConfig) {
    if (!cfg.apiKey) throw new Error('AgentMailConfig: apiKey is required');
    if (!cfg.fromInboxId) throw new Error('AgentMailConfig: fromInboxId is required');
    this.client = new AgentMailClient({ apiKey: cfg.apiKey });
    this.webhook = cfg.inboundWebhookSecret ? new Webhook(cfg.inboundWebhookSecret) : null;
  }

  static fromEnv(): AgentMailService {
    const apiKey = process.env.AGENTMAIL_API_KEY;
    if (!apiKey) {
      throw new Error(
        'AGENTMAIL_API_KEY environment variable is required when AgentMail is enabled. ' +
        'Set AGENTMAIL_ENABLED=false to use Mailpit fallback in development.',
      );
    }
    return new AgentMailService({
      apiKey,
      fromInboxId: process.env.AGENTMAIL_FROM_ADDRESS ?? 'argoai@agentmail.to',
      inboundWebhookSecret: process.env.AGENTMAIL_INBOUND_WEBHOOK_SECRET ?? '',
      replyDomain: process.env.AGENTMAIL_REPLY_DOMAIN ?? 'agentmail.to',
    });
  }

  async send(email: OutboundEmail): Promise<SendResult> {
    const sentAt = new Date().toISOString();
    try {
      // The SDK signature: client.inboxes.messages.send(inboxId, { to, ... })
      // We collapse to a single primary recipient because SDK accepts string|string[]
      // for `to`. cc/bcc go through directly.
      const recipients = email.to.map((r) => r.email);
      const cc = email.cc.map((r) => r.email);
      const bcc = email.bcc.map((r) => r.email);
      const result = await this.client.inboxes.messages.send(this.cfg.fromInboxId, {
        to: recipients.length === 1 ? recipients[0]! : recipients,
        ...(cc.length > 0 ? { cc } : {}),
        ...(bcc.length > 0 ? { bcc } : {}),
        subject: email.subject,
        text: email.textBody,
        ...(email.htmlBody ? { html: email.htmlBody } : {}),
        labels: [`argo:${email.kind}`, ...(email.operationId ? [`argo:op:${email.operationId}`] : [])],
      } as Parameters<typeof this.client.inboxes.messages.send>[1]);
      const id =
        (result as { id?: string; messageId?: string }).id ??
        (result as { messageId?: string }).messageId ??
        `am_${nanoid(16)}`;
      return { providerMessageId: id, acceptedAt: sentAt };
    } catch (err) {
      log.error({ err, kind: email.kind }, 'agentmail send failed');
      throw new Error(`AgentMail send failed: ${String(err).slice(0, 200)}`);
    }
  }

  async listThread(_args: ListThreadArgs): Promise<InboundEmail[]> {
    // v1 — not needed for the demo path. The threads endpoint exists but
    // we currently load context from our own MongoDB persistence.
    return [];
  }

  async getDeliveryStatus(providerMessageId: string): Promise<DeliveryStatus | null> {
    // AgentMail doesn't have a public "get message status" SDK call in v0.4
    // we treat acceptance as the proxy for delivery; bounces flow back as
    // webhook events the inbound handler dispatches.
    return {
      providerMessageId,
      status: 'sent',
      updatedAt: new Date().toISOString(),
    };
  }

  verifyInboundWebhook(args: {
    rawBody: string | Buffer;
    headers: Record<string, string | string[] | undefined>;
  }): boolean {
    if (!this.webhook) return false;
    try {
      const headerObj: Record<string, string> = {};
      for (const [k, v] of Object.entries(args.headers)) {
        if (typeof v === 'string') headerObj[k.toLowerCase()] = v;
        else if (Array.isArray(v) && v[0]) headerObj[k.toLowerCase()] = v[0];
      }
      const body = typeof args.rawBody === 'string' ? args.rawBody : args.rawBody.toString('utf8');
      this.webhook.verify(body, headerObj);
      return true;
    } catch (err) {
      log.warn({ err }, 'svix verification failed');
      return false;
    }
  }

  async parseInboundWebhook(args: {
    rawBody: string | Buffer;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<InboundEmail> {
    const valid = this.verifyInboundWebhook(args);
    const raw = typeof args.rawBody === 'string' ? args.rawBody : args.rawBody.toString('utf8');
    const parsed = JSON.parse(raw) as AgentMailWebhookPayload;
    const message = parsed.message ?? {};
    return {
      id: message.id ?? `inb_${nanoid(16)}`,
      receivedAt: message.received_at ?? new Date().toISOString(),
      from: { name: message.from?.name, email: message.from?.email ?? 'unknown@unknown' },
      to: (message.to ?? []).map((r) => ({ name: r.name, email: r.email })),
      subject: message.subject ?? '(no subject)',
      textBody: message.text ?? '',
      htmlBody: message.html,
      inReplyToMessageId: message.in_reply_to,
      threadId: message.thread_id,
      rawHeaders: message.headers ?? {},
      attachments: (message.attachments ?? []).map((a) => ({
        filename: a.filename,
        contentType: a.content_type,
        size: a.size ?? 0,
        url: a.url,
      })),
      signatureValid: valid,
      routingHint: extractRoutingHint(parsed),
    };
  }
}

interface AgentMailWebhookPayload {
  event_type?: string;
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
    labels?: string[];
    metadata?: Record<string, string>;
  };
}

function extractRoutingHint(body: AgentMailWebhookPayload): InboundEmail['routingHint'] | undefined {
  // We tag every outbound email with `argo:op:<operationId>` and (for approval
  // emails) `argo:approval:<token>`. Inbound replies preserve labels.
  const labels = body.message?.labels ?? [];
  let operationId: string | undefined;
  let approvalToken: string | undefined;
  for (const label of labels) {
    if (label.startsWith('argo:op:')) operationId = label.slice('argo:op:'.length);
    if (label.startsWith('argo:approval:')) approvalToken = label.slice('argo:approval:'.length);
  }
  // Also check metadata as a fallback.
  const meta = body.message?.metadata ?? {};
  operationId = operationId ?? meta.argo_operation_id;
  approvalToken = approvalToken ?? meta.argo_approval_token;
  if (!operationId && !approvalToken) return undefined;
  return {
    ...(operationId !== undefined ? { operationId } : {}),
    ...(approvalToken !== undefined ? { approvalToken } : {}),
  };
}
