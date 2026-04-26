import { ContextEnvelope } from '@argo/shared-types';

/**
 * Context envelope construction and serialisation.
 *
 * Section 10: "Every prompt you send to the model has a constructed context
 * envelope, never an ad-hoc concatenation of strings. The envelope has six
 * fields. [...] Every model call logs the full envelope to
 * `agent_invocations` for replay and audit. When something goes wrong, you
 * replay the envelope, identify the field that misled the model, and fix
 * the envelope construction — not the prompt."
 *
 * The constructor here is the ONLY supported way to build an envelope.
 * Direct concatenation is forbidden by code review.
 */

export type EnvelopeBuilderArgs = {
  operationId: string;
  operationName: string;
  triggerKind: string;
  audience: string;
  outcome: string;
  recentEvents: Array<{ timestamp: string; kind: string; summary: string }>;
  triggerPayload: unknown;
  relevantTemplate?: {
    templateId: string;
    kind: string;
    body: string;
    approvalRate: number;
    sendsToDate: number;
  } | null;
  voiceCorpus?: Array<{ to: string; subject: string; body: string; sentAt: string }>;
  task: string;
  schemaName: string;
  constraints?: string[];
};

export function buildContextEnvelope(args: EnvelopeBuilderArgs) {
  const envelope = {
    operationSummary: {
      operationId: args.operationId,
      operationName: args.operationName,
      triggerKind: args.triggerKind,
      audience: args.audience,
      outcome: args.outcome,
    },
    recentEvents: args.recentEvents.slice(-12),
    triggerPayload: args.triggerPayload,
    relevantTemplate: args.relevantTemplate ?? null,
    voiceCorpus: (args.voiceCorpus ?? []).slice(-15),
    instruction: {
      task: args.task,
      schemaName: args.schemaName,
      constraints: args.constraints ?? [],
    },
  };
  return ContextEnvelope.parse(envelope);
}

/**
 * Renders an envelope into the prompt string sent to the model. The
 * structure is intentionally consistent so model attention focuses on the
 * same fields each call. Test it once, trust it forever.
 */
export function renderEnvelopeAsPrompt(envelope: ReturnType<typeof buildContextEnvelope>): string {
  const parts: string[] = [];

  parts.push('# Operation');
  parts.push(`name: ${envelope.operationSummary.operationName}`);
  parts.push(`trigger: ${envelope.operationSummary.triggerKind}`);
  parts.push(`audience: ${envelope.operationSummary.audience}`);
  parts.push(`outcome: ${envelope.operationSummary.outcome}`);
  parts.push('');

  parts.push('# Recent events (last 12, oldest first)');
  if (envelope.recentEvents.length === 0) {
    parts.push('(none yet)');
  } else {
    for (const e of envelope.recentEvents) {
      parts.push(`- ${e.timestamp} [${e.kind}] ${e.summary}`);
    }
  }
  parts.push('');

  parts.push('# Trigger payload');
  parts.push('```json');
  parts.push(safeJson(envelope.triggerPayload));
  parts.push('```');
  parts.push('');

  if (envelope.relevantTemplate) {
    parts.push('# Relevant template');
    parts.push(
      `kind=${envelope.relevantTemplate.kind} sends_to_date=${envelope.relevantTemplate.sendsToDate} approval_rate=${envelope.relevantTemplate.approvalRate.toFixed(3)}`,
    );
    parts.push('```');
    parts.push(envelope.relevantTemplate.body);
    parts.push('```');
    parts.push('');
  }

  if (envelope.voiceCorpus.length > 0) {
    parts.push('# Voice corpus (anonymised; preserve tone, brevity, signature)');
    for (const ex of envelope.voiceCorpus) {
      parts.push(`> Subject: ${ex.subject}`);
      for (const line of ex.body.split('\n').slice(0, 8)) parts.push(`> ${line}`);
      parts.push('');
    }
  }

  parts.push('# Instruction');
  parts.push(envelope.instruction.task);
  parts.push('');
  parts.push(`Output schema: ${envelope.instruction.schemaName}`);
  if (envelope.instruction.constraints.length > 0) {
    parts.push('Constraints (every one is mandatory):');
    for (const c of envelope.instruction.constraints) parts.push(`- ${c}`);
  }

  return parts.join('\n');
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
