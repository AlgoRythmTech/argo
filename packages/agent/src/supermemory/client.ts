// supermemory.ai client — persistent operator-memory layer.
//
// Plan for tomorrow: when the user finalises a brief, we POST a tiny
// memory record to supermemory ("Maya prefers concise rejection emails";
// "the Acme client wants candidates packaged with GitHub links").
// On every subsequent invocation Argo retrieves the top-K memories and
// folds them into the context envelope so the model writes in the right
// voice without being re-told.
//
// This file is the typed wrapper. The dispatcher in /context-augment.ts
// is what call sites hit. Both are wired through env so flipping
// SUPERMEMORY_ENABLED=true at any point activates the layer with no
// code change elsewhere.

import { request } from 'undici';

export interface MemoryEntry {
  /** Human-readable text the agent will read on retrieval. */
  content: string;
  /** Free-form metadata so we can filter by ownerId / operationId / kind. */
  metadata: {
    ownerId: string;
    operationId?: string;
    kind:
      | 'voice_preference'
      | 'client_quirk'
      | 'workflow_decision'
      | 'recurring_request'
      | 'do_not_do';
    tags?: string[];
  };
}

export interface RetrievedMemory {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  score: number;
}

export interface SupermemoryConfig {
  apiKey: string;
  apiBase: string;
  enabled: boolean;
}

export class SupermemoryClient {
  constructor(private readonly cfg: SupermemoryConfig) {}

  static fromEnv(): SupermemoryClient {
    return new SupermemoryClient({
      apiKey: process.env.SUPERMEMORY_API_KEY ?? '',
      apiBase: process.env.SUPERMEMORY_API_BASE ?? 'https://api.supermemory.ai',
      enabled: (process.env.SUPERMEMORY_ENABLED ?? 'false').toLowerCase() === 'true',
    });
  }

  get isEnabled(): boolean {
    return this.cfg.enabled && this.cfg.apiKey.length > 0;
  }

  async remember(entry: MemoryEntry): Promise<{ ok: boolean; id?: string }> {
    if (!this.isEnabled) return { ok: false };
    try {
      const res = await request(`${this.cfg.apiBase}/v3/memories`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.cfg.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          content: entry.content,
          metadata: entry.metadata,
          containerTags: [
            `owner:${entry.metadata.ownerId}`,
            ...(entry.metadata.operationId ? [`op:${entry.metadata.operationId}`] : []),
            `kind:${entry.metadata.kind}`,
          ],
        }),
        bodyTimeout: 15_000,
      });
      if (res.statusCode >= 400) return { ok: false };
      const body = (await res.body.json()) as { id?: string };
      return { ok: true, ...(body.id !== undefined ? { id: body.id } : {}) };
    } catch {
      return { ok: false };
    }
  }

  async recall(args: {
    query: string;
    ownerId: string;
    operationId?: string;
    limit?: number;
  }): Promise<RetrievedMemory[]> {
    if (!this.isEnabled) return [];
    try {
      const containerTags = [
        `owner:${args.ownerId}`,
        ...(args.operationId ? [`op:${args.operationId}`] : []),
      ];
      const res = await request(`${this.cfg.apiBase}/v3/search`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.cfg.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          q: args.query,
          containerTags,
          limit: args.limit ?? 8,
        }),
        bodyTimeout: 12_000,
      });
      if (res.statusCode >= 400) return [];
      const body = (await res.body.json()) as { results?: Array<{ id: string; content: string; metadata?: Record<string, unknown>; score?: number }> };
      return (body.results ?? []).map((r) => ({
        id: r.id,
        content: r.content,
        metadata: r.metadata ?? {},
        score: typeof r.score === 'number' ? r.score : 0,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Enumerate memories for an owner (and optionally an operation). The
   * transparency UI calls this so the operator can see — and prune —
   * everything Argo has internalised about them. We use a wildcard
   * search (q='*') against the same containerTags filter the writer
   * uses so retention semantics line up exactly.
   */
  async list(args: {
    ownerId: string;
    operationId?: string;
    limit?: number;
  }): Promise<RetrievedMemory[]> {
    if (!this.isEnabled) return [];
    try {
      const containerTags = [
        `owner:${args.ownerId}`,
        ...(args.operationId ? [`op:${args.operationId}`] : []),
      ];
      const res = await request(`${this.cfg.apiBase}/v3/search`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.cfg.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          q: '*',
          containerTags,
          limit: args.limit ?? 100,
        }),
        bodyTimeout: 12_000,
      });
      if (res.statusCode >= 400) return [];
      const body = (await res.body.json()) as {
        results?: Array<{
          id: string;
          content: string;
          metadata?: Record<string, unknown>;
          score?: number;
        }>;
      };
      return (body.results ?? []).map((r) => ({
        id: r.id,
        content: r.content,
        metadata: r.metadata ?? {},
        score: typeof r.score === 'number' ? r.score : 0,
      }));
    } catch {
      return [];
    }
  }

  async forget(memoryId: string): Promise<{ ok: boolean }> {
    if (!this.isEnabled) return { ok: false };
    try {
      const res = await request(`${this.cfg.apiBase}/v3/memories/${memoryId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${this.cfg.apiKey}` },
      });
      return { ok: res.statusCode < 400 };
    } catch {
      return { ok: false };
    }
  }
}
