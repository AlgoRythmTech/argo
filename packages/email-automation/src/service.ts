import type { InboundEmail, OutboundEmail } from '@argo/shared-types';

/**
 * The single email-plane interface every callsite depends on.
 *
 * Section 13: "[AgentMail] is the email plane, wrapped behind
 * EmailAutomationService. Same logic — same insurance."
 *
 * Two implementations live in this package:
 *   - AgentMailService (production)
 *   - MailpitService   (dev fallback when AGENTMAIL_ENABLED=false)
 *
 * Route handlers MUST NOT depend on either concretion. Always inject
 * EmailAutomationService.
 */

export type SendResult = {
  providerMessageId: string;
  acceptedAt: string;
};

export type ListThreadArgs = {
  threadId: string;
  limit?: number;
};

export type EmailDeliveryStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'bounced'
  | 'complained'
  | 'unknown';

export type DeliveryStatus = {
  providerMessageId: string;
  status: EmailDeliveryStatus;
  updatedAt: string;
};

export interface EmailAutomationService {
  readonly name: 'agentmail' | 'mailpit';

  /** Send an outbound email. Schema-validated by the caller. */
  send(email: OutboundEmail): Promise<SendResult>;

  /** Optional thread fetch — used by inbound parser to ground a reply. */
  listThread(args: ListThreadArgs): Promise<InboundEmail[]>;

  /** Best-effort delivery status. */
  getDeliveryStatus(providerMessageId: string): Promise<DeliveryStatus | null>;

  /** Verify that an inbound webhook actually came from the provider. */
  verifyInboundWebhook(args: {
    rawBody: string | Buffer;
    headers: Record<string, string | string[] | undefined>;
  }): boolean;

  /** Parse the provider-shaped webhook payload into our InboundEmail. */
  parseInboundWebhook(args: {
    rawBody: string | Buffer;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<InboundEmail>;
}
