import { escapeForEmail, renderTemplate, sanitiseSubject } from '@argo/security';
import type { OutboundEmail } from '@argo/shared-types';

/**
 * The locked email shapes from Section 8 of the master prompt.
 *
 * Doctrine 2 — Approval emails are templated, plain text, and the same
 * shape every time. THREE buttons. Three. Not five.
 *
 * Doctrine 5 — Every email starts with `[Argo · {OperationName}]`.
 *
 * Variables are HTML-escaped via escapeForEmail() — no exceptions.
 */

export type ApprovalEmailContext = {
  operationName: string;
  ownerFirstName: string;
  itemSummary: string;
  matchHeadline?: string;
  criteria?: Array<{ matched: boolean; description: string }>;
  draftPreview: string[];
  approveUrl: string;
  editUrl: string;
  declineUrl: string;
};

export function renderApprovalEmail(ctx: ApprovalEmailContext): { subject: string; text: string; html: string } {
  const op = sanitiseSubject(ctx.operationName);
  const subject = sanitiseSubject(`[Argo · ${op}] ${ctx.itemSummary}`);

  const criteriaLines = (ctx.criteria ?? [])
    .map((c) => `  ${c.matched ? '✓' : '✗'} ${c.description}`)
    .join('\n');

  const draftLines = ctx.draftPreview.map((line) => `  > ${line}`).join('\n');

  const text = [
    `${ctx.ownerFirstName},`,
    '',
    ctx.itemSummary,
    '',
    ...(ctx.matchHeadline ? [ctx.matchHeadline, ''] : []),
    ...(criteriaLines ? [criteriaLines, ''] : []),
    'Draft:',
    draftLines,
    '',
    `[ APPROVE & SEND ]   ${ctx.approveUrl}`,
    `[ EDIT FIRST ]       ${ctx.editUrl}`,
    `[ DECLINE ]          ${ctx.declineUrl}`,
    '',
    'Reply to this email with notes if you\'d like Argo to learn from this decision.',
    '',
    '— Argo',
  ].join('\n');

  const html = renderApprovalEmailHtml({
    operationName: op,
    ownerFirstName: ctx.ownerFirstName,
    itemSummary: ctx.itemSummary,
    matchHeadline: ctx.matchHeadline,
    criteria: ctx.criteria ?? [],
    draftPreview: ctx.draftPreview,
    approveUrl: ctx.approveUrl,
    editUrl: ctx.editUrl,
    declineUrl: ctx.declineUrl,
  });

  return { subject, text, html };
}

function renderApprovalEmailHtml(ctx: Required<Omit<ApprovalEmailContext, 'matchHeadline'>> & {
  matchHeadline?: string;
}): string {
  const headline = ctx.matchHeadline
    ? `<p style="margin:0 0 12px 0;font:14px/1.6 'IBM Plex Mono',ui-monospace,monospace">${escapeForEmail(ctx.matchHeadline)}</p>`
    : '';

  const criteria = ctx.criteria
    .map(
      (c) =>
        `<div style="font:13px/1.6 'IBM Plex Mono',ui-monospace,monospace;color:${c.matched ? '#0a7d6c' : '#a14a4a'}">${c.matched ? '✓' : '✗'}&nbsp;${escapeForEmail(c.description)}</div>`,
    )
    .join('');

  const draft = ctx.draftPreview
    .map((line) => `<div style="font:13px/1.6 ui-monospace,monospace;color:#3d3d3d">&gt;&nbsp;${escapeForEmail(line)}</div>`)
    .join('');

  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f7f7f5;font:15px/1.6 ui-sans-serif,system-ui,-apple-system,sans-serif;color:#1a1a1a">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e7e5e4;border-radius:6px;padding:24px">
    <p style="margin:0 0 8px 0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#8a8480">[Argo · ${escapeForEmail(ctx.operationName)}]</p>
    <p style="margin:0 0 16px 0">${escapeForEmail(ctx.ownerFirstName)},</p>
    <p style="margin:0 0 16px 0">${escapeForEmail(ctx.itemSummary)}</p>
    ${headline}
    <div style="margin:0 0 16px 0">${criteria}</div>
    <p style="margin:0 0 8px 0;font-weight:600">Draft:</p>
    <div style="background:#fafaf9;border:1px solid #e7e5e4;border-radius:4px;padding:12px;margin:0 0 20px 0">${draft}</div>
    <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:0 0 16px 0">
      <tr>
        <td style="padding-right:8px"><a href="${escapeForEmail(ctx.approveUrl)}" style="display:inline-block;background:#00e5cc;color:#0a0a0b;padding:10px 16px;border-radius:4px;text-decoration:none;font-weight:600">APPROVE &amp; SEND</a></td>
        <td style="padding-right:8px"><a href="${escapeForEmail(ctx.editUrl)}" style="display:inline-block;background:#fff;border:1px solid #00e5cc;color:#0a0a0b;padding:10px 16px;border-radius:4px;text-decoration:none">EDIT FIRST</a></td>
        <td><a href="${escapeForEmail(ctx.declineUrl)}" style="display:inline-block;background:#fff;border:1px solid #e7e5e4;color:#8a8480;padding:10px 16px;border-radius:4px;text-decoration:none">DECLINE</a></td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#8a8480">Reply to this email with notes if you'd like Argo to learn from this decision.</p>
    <p style="margin:16px 0 0 0;font-size:13px;color:#8a8480">— Argo</p>
  </div>
</body></html>`;
}

export type DigestEmailContext = {
  operationName: string;
  ownerFirstName: string;
  /** The three paragraphs the LLM produced. Already prose, never bullet lists. */
  paragraphs: [string, string, string];
  /** If the third paragraph offered an action, this is the link to grant it. */
  proposedActionUrl?: string;
  proposedActionLabel?: string;
};

export function renderDigestEmail(ctx: DigestEmailContext): { subject: string; text: string; html: string } {
  const op = sanitiseSubject(ctx.operationName);
  const subject = sanitiseSubject(`[Argo · ${op}] Your week, summarised`);
  const text = [
    `${ctx.ownerFirstName},`,
    '',
    ctx.paragraphs[0],
    '',
    ctx.paragraphs[1],
    '',
    ctx.paragraphs[2],
    '',
    ...(ctx.proposedActionUrl && ctx.proposedActionLabel
      ? [`[ ${ctx.proposedActionLabel.toUpperCase()} ]   ${ctx.proposedActionUrl}`, '']
      : []),
    '— Argo',
  ].join('\n');

  const action =
    ctx.proposedActionUrl && ctx.proposedActionLabel
      ? `<p style="margin:24px 0 0 0"><a href="${escapeForEmail(ctx.proposedActionUrl)}" style="display:inline-block;background:#00e5cc;color:#0a0a0b;padding:10px 16px;border-radius:4px;text-decoration:none;font-weight:600">${escapeForEmail(ctx.proposedActionLabel)}</a></p>`
      : '';

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f7f7f5;font:15px/1.65 ui-sans-serif,system-ui,sans-serif;color:#1a1a1a">
  <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e7e5e4;border-radius:6px;padding:28px">
    <p style="margin:0 0 8px 0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#8a8480">[Argo · ${escapeForEmail(op)}]</p>
    <p style="margin:0 0 16px 0">${escapeForEmail(ctx.ownerFirstName)},</p>
    <p style="margin:0 0 16px 0">${escapeForEmail(ctx.paragraphs[0])}</p>
    <p style="margin:0 0 16px 0">${escapeForEmail(ctx.paragraphs[1])}</p>
    <p style="margin:0">${escapeForEmail(ctx.paragraphs[2])}</p>
    ${action}
    <p style="margin:24px 0 0 0;font-size:13px;color:#8a8480">— Argo</p>
  </div>
</body></html>`;

  return { subject, text, html };
}

export type RepairApprovalContext = {
  operationName: string;
  ownerFirstName: string;
  whatBroke: string;
  whatChanged: string;
  whatWeTested: string;
  approveUrl: string;
  reviewUrl: string;
};

export function renderRepairApprovalEmail(ctx: RepairApprovalContext): {
  subject: string;
  text: string;
  html: string;
} {
  const op = sanitiseSubject(ctx.operationName);
  const subject = sanitiseSubject(`[Argo · ${op}] Repair ready — small change`);
  const text = [
    `${ctx.ownerFirstName},`,
    '',
    `What broke: ${ctx.whatBroke}`,
    '',
    `What I changed: ${ctx.whatChanged}`,
    '',
    `What I tested: ${ctx.whatWeTested}`,
    '',
    `[ APPROVE REPAIR ]   ${ctx.approveUrl}`,
    `[ REVIEW FIRST ]     ${ctx.reviewUrl}`,
    '',
    '— Argo',
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f7f7f5;font:15px/1.6 ui-sans-serif,system-ui,sans-serif;color:#1a1a1a">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e7e5e4;border-radius:6px;padding:24px">
    <p style="margin:0 0 8px 0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#8a8480">[Argo · ${escapeForEmail(op)}]</p>
    <p style="margin:0 0 16px 0">${escapeForEmail(ctx.ownerFirstName)},</p>
    <p style="margin:0 0 12px 0"><strong>What broke.</strong> ${escapeForEmail(ctx.whatBroke)}</p>
    <p style="margin:0 0 12px 0"><strong>What I changed.</strong> ${escapeForEmail(ctx.whatChanged)}</p>
    <p style="margin:0 0 20px 0"><strong>What I tested.</strong> ${escapeForEmail(ctx.whatWeTested)}</p>
    <table cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding-right:8px"><a href="${escapeForEmail(ctx.approveUrl)}" style="display:inline-block;background:#00e5cc;color:#0a0a0b;padding:10px 16px;border-radius:4px;text-decoration:none;font-weight:600">APPROVE REPAIR</a></td>
      <td><a href="${escapeForEmail(ctx.reviewUrl)}" style="display:inline-block;background:#fff;border:1px solid #00e5cc;color:#0a0a0b;padding:10px 16px;border-radius:4px;text-decoration:none">REVIEW FIRST</a></td>
    </tr></table>
    <p style="margin:24px 0 0 0;font-size:13px;color:#8a8480">— Argo</p>
  </div>
</body></html>`;
  return { subject, text, html };
}

export type MagicLinkContext = {
  recipientFirstName: string;
  loginUrl: string;
  expiresInMinutes: number;
};

export function renderMagicLinkEmail(ctx: MagicLinkContext): { subject: string; text: string; html: string } {
  const subject = '[Argo] Your sign-in link';
  const text = [
    `${ctx.recipientFirstName},`,
    '',
    'Tap below to sign in to Argo.',
    '',
    `[ SIGN IN ]   ${ctx.loginUrl}`,
    '',
    `This link expires in ${ctx.expiresInMinutes} minutes.`,
    '',
    '— Argo',
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f7f7f5;font:15px/1.6 ui-sans-serif,system-ui,sans-serif;color:#1a1a1a">
  <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e7e5e4;border-radius:6px;padding:24px">
    <p style="margin:0 0 8px 0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#8a8480">[Argo]</p>
    <p style="margin:0 0 16px 0">${escapeForEmail(ctx.recipientFirstName)},</p>
    <p style="margin:0 0 20px 0">Tap below to sign in to Argo.</p>
    <p style="margin:0 0 12px 0"><a href="${escapeForEmail(ctx.loginUrl)}" style="display:inline-block;background:#00e5cc;color:#0a0a0b;padding:10px 16px;border-radius:4px;text-decoration:none;font-weight:600">SIGN IN</a></p>
    <p style="margin:20px 0 0 0;font-size:13px;color:#8a8480">This link expires in ${ctx.expiresInMinutes} minutes.</p>
    <p style="margin:16px 0 0 0;font-size:13px;color:#8a8480">— Argo</p>
  </div>
</body></html>`;
  return { subject, text, html };
}

export type SystemAlertContext = {
  operationName: string;
  ownerFirstName: string;
  goodNewsHeadline: string;
  body: string;
};

export function renderSystemAlertEmail(ctx: SystemAlertContext): {
  subject: string;
  text: string;
  html: string;
} {
  const op = sanitiseSubject(ctx.operationName);
  const subject = sanitiseSubject(`[Argo · ${op}] ${ctx.goodNewsHeadline}`);
  const text = [`${ctx.ownerFirstName},`, '', ctx.body, '', '— Argo'].join('\n');
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f7f7f5;font:15px/1.6 ui-sans-serif,system-ui,sans-serif;color:#1a1a1a">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e7e5e4;border-radius:6px;padding:24px">
    <p style="margin:0 0 8px 0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#8a8480">[Argo · ${escapeForEmail(op)}]</p>
    <p style="margin:0 0 16px 0">${escapeForEmail(ctx.ownerFirstName)},</p>
    <p style="margin:0">${escapeForEmail(ctx.body)}</p>
    <p style="margin:24px 0 0 0;font-size:13px;color:#8a8480">— Argo</p>
  </div>
</body></html>`;
  return { subject, text, html };
}

/**
 * Generic third-party email renderer (forwards, rejections). Variable
 * substitution uses HTML-escaped renderTemplate.
 */
export function renderThirdPartyEmail(args: {
  operationName: string;
  subjectTemplate: string;
  bodyTemplate: string;
  variables: Record<string, unknown>;
}): { subject: string; text: string; html: string } {
  const subject = sanitiseSubject(renderTemplate(args.subjectTemplate, args.variables));
  const text = renderTemplate(args.bodyTemplate, args.variables);
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#fff;font:15px/1.6 ui-sans-serif,system-ui,sans-serif;color:#1a1a1a">
  <div style="max-width:560px;margin:0 auto">
    ${renderTemplate(args.bodyTemplate, args.variables, { mode: 'html' })
      .split('\n')
      .map((line) => (line.trim() ? `<p style="margin:0 0 12px 0">${line}</p>` : ''))
      .join('')}
  </div>
</body></html>`;
  return { subject, text, html };
}

/**
 * Build the OutboundEmail object the EmailAutomationService.send() expects,
 * starting from a rendered template + recipient.
 */
export function toOutboundEmail(args: {
  id: string;
  operationId: string | null;
  kind: OutboundEmail['kind'];
  from: { name?: string; email: string };
  to: Array<{ name?: string; email: string }>;
  rendered: { subject: string; text: string; html: string };
  approvalLinks?: { approve: string; edit: string; decline: string };
  templateId?: string;
  metadata?: Record<string, string>;
}): OutboundEmail {
  return {
    id: args.id,
    operationId: args.operationId,
    kind: args.kind,
    from: { ...(args.from.name ? { name: args.from.name } : {}), email: args.from.email },
    to: args.to.map((t) => ({ ...(t.name ? { name: t.name } : {}), email: t.email })),
    cc: [],
    bcc: [],
    subject: args.rendered.subject,
    textBody: args.rendered.text,
    htmlBody: args.rendered.html,
    headers: { 'X-Argo-Kind': args.kind, 'X-Argo-Operation': args.operationId ?? '' },
    attachments: [],
    ...(args.approvalLinks ? { approvalLinks: args.approvalLinks } : {}),
    ...(args.templateId ? { templateId: args.templateId } : {}),
    metadata: args.metadata ?? {},
  };
}
