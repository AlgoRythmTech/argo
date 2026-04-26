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
