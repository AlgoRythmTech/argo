import { z } from 'zod';
import { EmailAddress, IsoDateString, ShortId, Url } from './common.js';

/**
 * Email kind drives template selection and the trust ratchet.
 * `outbound_third_party` is the only kind that is gated by approval.
 * `system_to_owner` (digests, repair requests) does not pass through the
 * approval gate — Maya is the owner and consents implicitly to those.
 */
export const EmailKind = z.enum([
  'approval_request',
  'system_to_owner',
  'digest_to_owner',
  'outbound_third_party',
  'auto_reply',
  'magic_link',
  'repair_approval',
]);
export type EmailKind = z.infer<typeof EmailKind>;

export const ApprovalAction = z.enum(['approve', 'edit', 'decline']);
export type ApprovalAction = z.infer<typeof ApprovalAction>;

export const ApprovalToken = z.object({
  token: z.string().min(32).max(120),
  approvalId: ShortId,
  operationId: ShortId,
  expiresAt: IsoDateString,
  action: ApprovalAction.optional(),
});
export type ApprovalToken = z.infer<typeof ApprovalToken>;

export const EmailRecipient = z.object({
  name: z.string().max(160).optional(),
  email: EmailAddress,
});
export type EmailRecipient = z.infer<typeof EmailRecipient>;

/**
 * The on-the-wire shape we hand to AgentMail. Body is plain text + minimal
 * HTML (graceful degradation). No frameworks. No tracking pixels. No images.
 */
export const OutboundEmail = z.object({
  id: ShortId,
  operationId: ShortId.nullable(),
  kind: EmailKind,
  from: EmailRecipient,
  replyTo: EmailRecipient.optional(),
  to: z.array(EmailRecipient).min(1).max(20),
  cc: z.array(EmailRecipient).max(20).default([]),
  bcc: z.array(EmailRecipient).max(20).default([]),
  subject: z.string().min(1).max(300),
  textBody: z.string().min(1),
  htmlBody: z.string().optional(),
  headers: z.record(z.string(), z.string()).default({}),
  attachments: z
    .array(
      z.object({
        filename: z.string().min(1).max(240),
        contentType: z.string().min(3).max(120),
        size: z.number().int().nonnegative(),
        url: Url.optional(),
        contentBase64: z.string().optional(),
      }),
    )
    .max(10)
    .default([]),
  approvalLinks: z
    .object({
      approve: Url,
      edit: Url,
      decline: Url,
    })
    .optional(),
  templateId: ShortId.optional(),
  metadata: z.record(z.string(), z.string()).default({}),
});
export type OutboundEmail = z.infer<typeof OutboundEmail>;

export const InboundEmail = z.object({
  id: ShortId,
  receivedAt: IsoDateString,
  from: EmailRecipient,
  to: z.array(EmailRecipient).min(1),
  subject: z.string().max(300),
  textBody: z.string(),
  htmlBody: z.string().optional(),
  inReplyToMessageId: z.string().optional(),
  threadId: z.string().optional(),
  rawHeaders: z.record(z.string(), z.string()).default({}),
  attachments: z
    .array(
      z.object({
        filename: z.string(),
        contentType: z.string(),
        size: z.number().int().nonnegative(),
        url: Url.optional(),
      }),
    )
    .default([]),
  signatureValid: z.boolean(),
  routingHint: z
    .object({
      operationId: ShortId.optional(),
      approvalToken: z.string().optional(),
    })
    .optional(),
});
export type InboundEmail = z.infer<typeof InboundEmail>;

export const TemplateKind = z.enum([
  'approval_to_owner',
  'rejection_to_third_party',
  'forward_to_third_party',
  'screening_invite',
  'digest',
  'repair_request',
  'system_alert',
  'magic_link',
]);
export type TemplateKind = z.infer<typeof TemplateKind>;

/**
 * The trust ratchet unit. `sendsToDate` and `approvalsToDate` are the two
 * counters that decide when the gate becomes opt-in (>=10 sends and >=95%
 * approval). These thresholds are environment-configured but defaulted in
 * /packages/security/src/trust-ratchet.ts.
 */
export const EmailTemplate = z.object({
  id: ShortId,
  operationId: ShortId,
  kind: TemplateKind,
  name: z.string().min(1).max(120),
  subjectTemplate: z.string().min(1).max(300),
  bodyTemplate: z.string().min(1),
  variables: z.array(z.string()).default([]),
  approvalRequired: z.boolean().default(true),
  sendsToDate: z.number().int().nonnegative().default(0),
  approvalsToDate: z.number().int().nonnegative().default(0),
  approvalRate: z.number().min(0).max(1).default(0),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});
export type EmailTemplate = z.infer<typeof EmailTemplate>;
