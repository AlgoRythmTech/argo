// Augments any agent invocation's context envelope with memories
// retrieved from supermemory. Off when SUPERMEMORY_ENABLED=false; the
// augmented envelope falls back to identical-to-input.

import { SupermemoryClient, type RetrievedMemory } from './client.js';

let client: SupermemoryClient | null = null;
function getClient(): SupermemoryClient {
  if (!client) client = SupermemoryClient.fromEnv();
  return client;
}

export interface AugmentArgs {
  ownerId: string;
  operationId?: string;
  /** Free-text used to retrieve relevant memories. Usually the user prompt. */
  query: string;
  /** Cap on memories injected into the envelope. Default 6. */
  limit?: number;
}

export async function recallRelevantMemories(args: AugmentArgs): Promise<RetrievedMemory[]> {
  const c = getClient();
  if (!c.isEnabled) return [];
  return c.recall({
    query: args.query,
    ownerId: args.ownerId,
    ...(args.operationId !== undefined ? { operationId: args.operationId } : {}),
    limit: args.limit ?? 6,
  });
}

export function renderMemoriesAsPromptSection(memories: readonly RetrievedMemory[]): string {
  if (memories.length === 0) return '';
  const lines: string[] = [];
  lines.push('# Operator memory (relevant past decisions / preferences)');
  lines.push('');
  lines.push('These were learned from past Argo invocations. Honor them unless the current');
  lines.push('brief explicitly contradicts. Each line is one fact.');
  lines.push('');
  for (const m of memories) {
    const tag = (m.metadata as { kind?: string }).kind ?? 'memory';
    lines.push(`- **[${tag}]** ${m.content}`);
  }
  return lines.join('\n');
}

/**
 * Convenience: write a new memory based on what the operator just did.
 * Called from the API layer at significant decision points (brief
 * compiled, repair approved, template saved, etc.).
 */
export async function rememberDecision(args: {
  ownerId: string;
  operationId?: string;
  kind:
    | 'voice_preference'
    | 'client_quirk'
    | 'workflow_decision'
    | 'recurring_request'
    | 'do_not_do';
  content: string;
  tags?: string[];
}): Promise<{ ok: boolean }> {
  const c = getClient();
  return c.remember({
    content: args.content,
    metadata: {
      ownerId: args.ownerId,
      ...(args.operationId !== undefined ? { operationId: args.operationId } : {}),
      kind: args.kind,
      ...(args.tags !== undefined ? { tags: args.tags } : {}),
    },
  });
}
