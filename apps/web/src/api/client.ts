/**
 * Tiny typed fetch wrapper. Uses the Vite dev proxy so /api and /auth land
 * on the Fastify control plane. Cookies (argo_session) are sent with every
 * request via `credentials: 'include'`.
 */

const BASE = ((import.meta as unknown) as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function send<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { error: 'invalid_response', raw: text.slice(0, 400) };
    }
  }
  if (!res.ok) {
    const err = parsed as { error?: string; message?: string } | null;
    throw new ApiError(res.status, err?.error ?? 'unknown_error', err?.message ?? text);
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string) => send<T>('GET', path),
  post: <T>(path: string, body?: unknown) => send<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => send<T>('PATCH', path, body),
  del: <T>(path: string) => send<T>('DELETE', path),
};

// ── Typed endpoints ─────────────────────────────────────────────────────

export type Me = {
  sessionId: string;
  userId: string;
  email: string;
  expiresAt: string;
};

export type Operation = {
  id: string;
  slug: string;
  name: string;
  status:
    | 'draft'
    | 'mapping'
    | 'awaiting_user_confirmation'
    | 'building'
    | 'testing'
    | 'deploying'
    | 'running'
    | 'paused'
    | 'failed_build'
    | 'archived';
  publicUrl: string | null;
  pendingApprovals: number;
  submissionsToday: number;
  lastEventAt: string | null;
  timezone: string;
  createdAt: string;
  updatedAt: string;
};

export type ActivityEntry = {
  id: string;
  operationId: string | null;
  operationName: string | null;
  kind: string;
  message: string;
  occurredAt: string;
};

export type BuilderQuestion = { id: string; prompt: string; helper?: string };
export type BuilderTrigger = 'form_submission' | 'email_received' | 'scheduled';

export const auth = {
  me: () => api.get<Me>('/auth/me'),
  requestMagicLink: (email: string) =>
    api.post<{ ok: true; message: string }>('/auth/magic-link', { email }),
  logout: () => api.post<{ ok: true }>('/auth/logout'),
};

export type NotificationItem = {
  id: string;
  operationId: string | null;
  operationName: string | null;
  kind: string;
  message: string;
  occurredAt: string;
  readAt: string | null;
};

export const notifications = {
  list: (params?: {
    unreadOnly?: boolean;
    kind?: string;
    operationId?: string;
    q?: string;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.unreadOnly) qs.set('unreadOnly', 'true');
    if (params?.kind) qs.set('kind', params.kind);
    if (params?.operationId) qs.set('operationId', params.operationId);
    if (params?.q) qs.set('q', params.q);
    if (params?.limit) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return api.get<{ unreadCount: number; notifications: NotificationItem[] }>(
      `/api/notifications${suffix}`,
    );
  },
  markRead: (id: string) => api.post<{ ok: true }>(`/api/notifications/${id}/read`, {}),
  markAllRead: () =>
    api.post<{ ok: true; marked: number }>('/api/notifications/mark-all-read', {}),
};

export type ReplayInvocation = {
  id: string;
  operationId: string | null;
  operationName: string | null;
  kind: string;
  status: string;
  provider: string;
  model: string;
  durationMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
  createdAt: string;
  completedAt: string | null;
  errorMessage: string | null;
};

export const replay = {
  list: (params?: { operationId?: string; kind?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.operationId) qs.set('operationId', params.operationId);
    if (params?.kind) qs.set('kind', params.kind);
    if (params?.limit) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return api.get<{ invocations: ReplayInvocation[] }>(`/api/replay/invocations${suffix}`);
  },
  get: (id: string) => api.get<Record<string, unknown>>(`/api/replay/invocations/${id}`),
};

export const billing = {
  checkout: (input?: { successPath?: string; cancelPath?: string }) =>
    api.post<{ url: string | null; sessionId: string }>('/api/billing/checkout', input ?? {}),
  portal: () => api.post<{ url: string }>('/api/billing/portal', {}),
};

export type GeneratedFileSummary = {
  path: string;
  sha256: string;
  argoGenerated: boolean;
  size: number;
};

export type GeneratedBundle = {
  operationId: string;
  version: number;
  generatedByModel: string;
  files: GeneratedFileSummary[];
};

export type PreviewAction = 'refresh' | 'restart' | 'rebuild';

export const operations = {
  list: () => api.get<Operation[]>('/api/operations'),
  create: (input: { name: string; timezone?: string }) =>
    api.post<Operation>('/api/operations', input),
  get: (id: string) => api.get<Operation>(`/api/operations/${id}`),
  update: (id: string, patch: Partial<Pick<Operation, 'name' | 'status'>>) =>
    api.patch<Operation>(`/api/operations/${id}`, patch),
  map: (id: string) => api.get<{ map: unknown; version: number }>(`/api/operations/${id}/map`),
  deploy: (id: string) =>
    api.post<{ ok: true; operationId: string; bundleVersion: number; publicUrl: string }>(
      '/api/operations/deploy',
      { operationId: id },
    ),
  archive: (id: string) => api.post<Operation>(`/api/operations/${id}/archive`, {}),
  restore: (id: string) => api.post<Operation>(`/api/operations/${id}/restore`, {}),
  delete: async (id: string) => {
    const res = await fetch(`/api/operations/${id}`, { method: 'DELETE', credentials: 'include' });
    if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
    return { ok: true } as const;
  },
  files: (id: string) => api.get<GeneratedBundle>(`/api/operations/${id}/files`),
  fileContents: (id: string, path: string) =>
    api.get<{
      operationId: string;
      path: string;
      contents: string;
      sha256: string;
      argoGenerated: boolean;
      bytes: number;
    }>(`/api/operations/${id}/files/contents?path=${encodeURIComponent(path)}`),
  previewAction: (id: string, action: PreviewAction) =>
    api.post<{ ok: true; action: PreviewAction }>(`/api/operations/${id}/preview-action`, {
      action,
    }),
  bundleVersions: (id: string) =>
    api.get<{
      operationId: string;
      versions: Array<{
        version: number;
        createdAt: string;
        generatedByModel: string;
        aiCycles: number;
      }>;
    }>(`/api/operations/${id}/bundle-versions`),
  bundleDiff: (id: string, from: number, to: number) =>
    api.get<{
      operationId: string;
      from: number;
      to: number;
      summary: { added: number; removed: number; modified: number; unchanged: number };
      diffs: Array<{
        path: string;
        change: 'added' | 'removed' | 'modified' | 'unchanged';
        fromSha: string | null;
        toSha: string | null;
        fromContents?: string;
        toContents?: string;
      }>;
    }>(`/api/operations/${id}/bundle-diff?from=${from}&to=${to}`),
};

export const builder = {
  start: (operationId: string, description: string) =>
    api.post<{ trigger: BuilderTrigger; questions: BuilderQuestion[] }>('/api/builder/start', {
      operationId,
      description,
    }),
  submitAnswers: (input: {
    operationId: string;
    rawDescription: string;
    trigger: BuilderTrigger;
    answers: Record<string, string>;
  }) =>
    api.post<{
      operationId: string;
      mapVersion: number;
      map: unknown;
      fallbackUsed: boolean;
      invocationId: string;
    }>('/api/builder/submit-answers', input),
  editStep: (input: { operationId: string; targetStepId: string; userInstruction: string }) =>
    api.post<{ operationId: string; mapVersion: number; map: unknown }>('/api/builder/edit-step', input),
};

export const activity = {
  list: () => api.get<ActivityEntry[]>('/api/activity'),
};

export const repairs = {
  list: () => api.get<unknown[]>('/api/repairs'),
  get: (id: string) => api.get<unknown>(`/api/repairs/${id}`),
};
