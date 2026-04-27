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
 * Enumerate every memory we hold for an owner (optionally scoped to a
 * single operation). Drives the workspace Memory tab so operators can
 * see — and prune — what Argo has internalised about them.
 */
export async function listMemories(args: {
  ownerId: string;
  operationId?: string;
  limit?: number;
}): Promise<RetrievedMemory[]> {
  const c = getClient();
  if (!c.isEnabled) return [];
  return c.list({
    ownerId: args.ownerId,
    ...(args.operationId !== undefined ? { operationId: args.operationId } : {}),
    limit: args.limit ?? 100,
  });
}

/** Forget a single memory by id. Returns whether the upstream accepted the delete. */
export async function forgetMemory(memoryId: string): Promise<{ ok: boolean }> {
  const c = getClient();
  if (!c.isEnabled) return { ok: false };
  return c.forget(memoryId);
}

/** Whether the supermemory layer is configured + active in this process. */
export function memoryEnabled(): boolean {
  return getClient().isEnabled;
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
