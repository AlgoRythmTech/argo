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
  usage: () =>
    api.get<{
      totalUsd: number;
      monthStart: string;
      perOperation: Array<{
        operationId: string | null;
        operationName: string | null;
        totalUsd: number;
        invocations: number;
        promptTokens: number;
        completionTokens: number;
      }>;
    }>('/api/billing/usage'),
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
  health: (id: string) =>
    api.get<{
      operationId: string;
      tone: 'good' | 'warn' | 'bad';
      status: string;
      lastSubmissionAt: string | null;
      lastSubmissionAgeMs: number | null;
      submissionsLast24h: number;
      submissionsLast7d: number;
      failedInvocations24h: number;
      pendingRepairs: number;
      staleRepairs: number;
      lastEventAt: string | null;
      alerts: Array<{
        severity: 'info' | 'warn' | 'bad';
        kind: string;
        message: string;
      }>;
      checkedAt: string;
    }>(`/api/operations/${id}/health`),
  readme: (id: string, regenerate = false) =>
    api.get<{
      operationId: string;
      bundleVersion: number | null;
      generatedAt: string;
      cached: boolean;
      readme: {
        title: string;
        oneLine: string;
        whatItDoes: string;
        howItWorks: string;
        ifSomethingBreaks: string;
      };
      markdown: string;
    }>(`/api/operations/${id}/readme${regenerate ? '?regenerate=true' : ''}`),
  manifest: (id: string, bundleVersion?: number) => {
    const qs = bundleVersion ? `?bundleVersion=${bundleVersion}` : '';
    return api.get<{
      operationId: string;
      bundleVersion: number;
      generatedAt: string;
      manifest: {
        files: Array<{ path: string; bytes: number; argoGenerated: boolean; role: string }>;
        dependencies: Record<string, string>;
        agents: Array<{ name: string; file: string; model: string | null; tools: string[] }>;
        routes: Array<{ method: string; pattern: string; file: string }>;
        workflows: Array<{ name: string; file: string; steps: string[] }>;
        envVars: Array<{ name: string; firstUseFile: string; documented: boolean }>;
        generatedBytes: number;
        fileCount: number;
      };
      prose: {
        oneLine: string;
        overview: string;
        howItWorks: string;
        ifSomethingBreaks: string;
        knownLimitations: string;
      } | null;
      markdown: string;
    }>(`/api/operations/${id}/manifest${qs}`);
  },
  searchBundle: (id: string, q: string, caseSensitive = false) => {
    const qs = new URLSearchParams({ q });
    if (caseSensitive) qs.set('caseSensitive', 'true');
    return api.get<{
      operationId: string;
      bundleVersion: number | null;
      query: string;
      caseSensitive: boolean;
      matchCount: number;
      fileCount: number;
      truncated: boolean;
      files: Array<{
        path: string;
        argoGenerated: boolean;
        truncated: boolean;
        matches: Array<{
          line: number;
          text: string;
          before: string | null;
          after: string | null;
        }>;
      }>;
    }>(`/api/operations/${id}/files/search?${qs.toString()}`);
  },
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

export type IterateResult = {
  ok: boolean;
  regression: boolean;
  regressions: string[];
  diff: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
    changes: Array<{ path: string; change: 'added' | 'removed' | 'modified' | 'unchanged' }>;
  };
  bundleVersion?: number;
  publicUrl?: string;
  cycles: number;
  message?: string;
};

export const iterate = {
  run: (input: {
    operationId: string;
    instruction: string;
    strategy?: 'surgical' | 'rebuild' | 'auto';
  }) => api.post<IterateResult>('/api/operations/iterate', input),
  force: (operationId: string) =>
    api.post<{ ok: true; bundleVersion: number; publicUrl: string }>(
      '/api/operations/iterate/force',
      { operationId },
    ),
};

export const activity = {
  list: () => api.get<ActivityEntry[]>('/api/activity'),
};

export const repairs = {
  list: () => api.get<unknown[]>('/api/repairs'),
  get: (id: string) => api.get<unknown>(`/api/repairs/${id}`),
  decide: (id: string, decision: 'approve' | 'reject') =>
    api.post<{ ok: true; status: string }>(`/api/repairs/${id}/decision`, { decision }),
};

export type Template = {
  slug: string;
  name: string;
  category: 'workflow' | 'saas' | 'integration' | 'ai-agent';
  description: string;
  icon: string;
  tags: string[];
  estimatedBuildTime: string;
  fileCount: number;
  features: string[];
  brief: Record<string, unknown>;
};

export const templates = {
  list: () => api.get<Template[]>('/api/templates'),
  use: (slug: string) => api.post<Operation>(`/api/templates/${slug}/use`, {}),
};

export const dev = {
  seedDemo: () =>
    api.post<{
      ok: true;
      operationId: string;
      name: string;
      slug: string;
      publicUrl: string | null;
    }>('/api/dev/seed-demo', {}),
};

export type MemoryEntry = {
  id: string;
  content: string;
  kind: string;
  operationId: string | null;
  tags: string[];
  score: number;
};

export type MemoryListResponse = {
  enabled: boolean;
  count?: number;
  memories: MemoryEntry[];
  note?: string;
};

export const memory = {
  list: (params?: { operationId?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.operationId) qs.set('operationId', params.operationId);
    if (params?.limit) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return api.get<MemoryListResponse>(`/api/memory${suffix}`);
  },
  forget: (id: string) => api.del<{ ok: true }>(`/api/memory/${encodeURIComponent(id)}`),
};

// ── Chat ────────────────────────────────────────────────────────────────

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model: string | null;
  createdAt: string;
};

export type ChatThread = {
  threadId: string;
  operationId: string | null;
  lastMessage: string;
  lastRole: string;
  updatedAt: string;
  messageCount: number;
};

export const chat = {
  send: (input: { message: string; operationId?: string; threadId?: string }) =>
    api.post<{ threadId: string; response: string; model: string | null; operationId: string | null }>(
      '/api/chat',
      input,
    ),
  threads: () => api.get<{ threads: ChatThread[] }>('/api/chat/threads'),
  thread: (threadId: string) =>
    api.get<{ threadId: string; messages: ChatMessage[] }>(`/api/chat/threads/${threadId}`),
};

// ── Analytics ───────────────────────────────────────────────────────────

export type AnalyticsOverview = {
  operationCount: number;
  runningCount: number;
  totalSubmissionsToday: number;
  totalPendingApprovals: number;
  submissionsTimeline: Array<{ date: string; count: number }>;
  errorsTimeline: Array<{ date: string; count: number }>;
  approvals: {
    total: number;
    approved: number;
    declined: number;
    pending: number;
    expired: number;
    approvalRate: number;
  };
  llm: {
    totalInvocations: number;
    totalCostUsd: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    avgDurationMs: number;
    failedCount: number;
    successRate: number;
  };
  repairs: {
    total: number;
    awaiting: number;
    approved: number;
    deployed: number;
    rejected: number;
  };
  topOperations: Array<{
    operationId: string;
    operationName: string;
    totalSubmissions: number;
  }>;
};

export const analytics = {
  overview: () => api.get<AnalyticsOverview>('/api/analytics/overview'),
  operation: (id: string) => api.get<Record<string, unknown>>(`/api/analytics/operation/${id}`),
  roi: (operationId?: string) => {
    const qs = operationId ? `?operationId=${operationId}` : '';
    return api.get<ROIData>(`/api/analytics/roi${qs}`);
  },
};

// ── ROI Types ──────────────────────────────────────────────────────────

export type ROIData = {
  period: string;
  operationCount: number;
  hoursSaved: { thisMonth: number; thisWeek: number; perSubmission: number };
  submissions: {
    thisMonth: number;
    thisWeek: number;
    daily: Array<{ date: string; automated: number; manualCapacity: number }>;
  };
  responseTime: {
    currentAvgMinutes: number;
    previousAvgMinutes: number;
    improvementPercent: number;
  };
  breakdown: {
    autoProcessed: number;
    manualReview: number;
    escalated: number;
    autoRate: number;
  };
  selfHealing: { errorsDetected: number; autoFixed: number; humanTime: number };
  emailsProcessed: number;
  approvalsHandled: number;
  beforeAfter: {
    before: {
      avgResponseHours: number;
      submissionsPerDay: number;
      errorsPerWeek: number;
      hoursPerWeek: number;
      costPerMonth: number;
    };
    after: {
      avgResponseMinutes: number;
      submissionsPerDay: number;
      errorsPerWeek: number;
      hoursPerWeek: number;
      costPerMonth: number;
    };
  };
};

// ── Guardrails ─────────────────────────────────────────────────────────

export type GuardrailsReport = {
  operationId: string;
  bundleVersion: number;
  checkedAt: string;
  safetyScore: number;
  security: {
    scannedAt: string | null;
    categoriesScanned: number;
    passed: number;
    warnings: number;
    failed: number;
    results: Array<{
      category: string;
      label: string;
      status: 'pass' | 'warn' | 'fail';
      severity: string | null;
      details: string | null;
      count: number;
    }>;
  };
  qualityGate: {
    checkedAt: string | null;
    totalChecks: number;
    passed: number;
    categories: Array<{
      category: string;
      label: string;
      checks: Array<{
        id: string;
        label: string;
        status: string;
        message: string | null;
      }>;
      passCount: number;
      failCount: number;
    }>;
  };
  tests: {
    ranAt: string | null;
    totalTests: number;
    passed: number;
    failed: number;
    skipped: number;
    suites: Array<{
      name: string;
      total: number;
      passed: number;
      failed: number;
      durationMs: number;
    }>;
  };
  regressions: Array<{
    id: string;
    bundleVersion: number;
    baselineVersion: number;
    testsRun: number;
    testsPassed: number;
    testsFailed: number;
    regressionDetected: boolean;
    blockedDeploy: boolean;
    createdAt: string;
    durationMs: number;
  }>;
  approvalHistory: Array<{
    id: string;
    kind: string;
    message: string;
    occurredAt: string;
  }>;
  changeImpact: {
    filesChanged: number;
    testsCoveringChanges: number;
    riskLevel: 'low' | 'medium' | 'high';
  };
};

export const guardrails = {
  get: (operationId: string) =>
    api.get<GuardrailsReport>(`/api/operations/${operationId}/guardrails`),
  run: (operationId: string) =>
    api.post<{ ok: true; operationId: string; message: string }>(
      `/api/operations/${operationId}/guardrails/run`,
    ),
};

// ── Pipeline ───────────────────────────────────────────────────────────

export type PipelineStage = {
  id: string;
  name: string;
  summary: string;
  status: 'pending' | 'running' | 'passed' | 'failed';
  durationMs: number | null;
  details: Record<string, string | number> | null;
};

export type PipelineRun = {
  operationId: string;
  bundleVersion: number;
  startedAt: string | null;
  completedAt: string | null;
  status: string;
  stages: PipelineStage[];
};

export const pipeline = {
  get: (operationId: string) =>
    api.get<PipelineRun>(`/api/operations/${operationId}/pipeline`),
};

// ── Agent Builder ──────────────────────────────────────────────────────

export type AgentTool = {
  id: string;
  name: string;
  category: string;
  description: string;
  parameters: Array<{ name: string; type: string; required: boolean }>;
};

export type AgentTemplate = {
  slug: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  model: string;
  systemPrompt: string;
  tools: string[];
  trigger: string;
};

export type CustomAgent = {
  id: string;
  name: string;
  description: string;
  model: string;
  tools: string[];
  trigger: string;
  status: 'draft' | 'deployed' | 'paused';
  operationId: string | null;
  createdAt: string;
  updatedAt: string;
  invocationCount: number;
};

export const agents = {
  tools: () => api.get<{ tools: AgentTool[] }>('/api/agents/tools'),
  templates: () => api.get<{ templates: AgentTemplate[] }>('/api/agents/templates'),
  list: () => api.get<{ agents: CustomAgent[] }>('/api/agents'),
  create: (input: {
    name: string;
    description?: string;
    model: string;
    systemPrompt: string;
    tools: string[];
    trigger: string;
    temperature?: number;
    maxTokens?: number;
    operationId?: string;
  }) => api.post<{ ok: true; agentId: string; name: string; status: string }>('/api/agents', input),
  update: (id: string, patch: Record<string, unknown>) =>
    api.patch<{ ok: true; agent: CustomAgent }>(`/api/agents/${id}`, patch),
  test: (id: string, input: string) =>
    api.post<{
      ok: true;
      agentId: string;
      testResult: {
        input: string;
        reasoning: string;
        actions: Array<{ tool: string; status: string; result: string }>;
        output: string;
        model: string;
        tokensUsed: number;
        durationMs: number;
      };
    }>(`/api/agents/${id}/test`, { input }),
  deploy: (id: string, operationId?: string) =>
    api.post<{ ok: true; agentId: string; status: string; operationId: string | null }>(
      `/api/agents/${id}/deploy`,
      { operationId },
    ),
  delete: (id: string) => api.del<{ ok: true; deleted: true }>(`/api/agents/${id}`),
  fromTemplate: (templateSlug: string, operationId?: string) =>
    api.post<{ ok: true; agentId: string; name: string; status: string }>(
      '/api/agents/from-template',
      { templateSlug, operationId },
    ),
};

// ── Studio ─────────────────────────────────────────────────────────────

export type StudioQuestion = {
  id: string;
  text: string;
  options: Array<{ value: string; label: string; icon: string }>;
};

export type StudioDetectResponse = {
  workflowType: string;
  greeting: string;
  questions: StudioQuestion[];
};

export type StudioBuildResponse = {
  ok: true;
  operationId: string;
  operationSlug: string;
  config: {
    name: string;
    description: string;
    fields: Array<{
      id: string;
      label: string;
      type: string;
      placeholder?: string;
      required: boolean;
      options?: string[];
    }>;
    emails: {
      approval: { subject: string; body: string };
      rejection: { subject: string; body: string };
      confirmation: { subject: string; body: string };
      digest: { subject: string; body: string };
    };
    pipeline: string[];
    testCount: number;
    securityChecks: number;
    safetyScore: number;
  };
};

export type StudioSimulateResponse = {
  ok: true;
  operationId: string;
  submission: {
    id: string;
    name: string;
    role: string;
    score: number;
    verdict: 'strong_match' | 'no_match';
    skills: string[];
    analysis: {
      experience: string;
      cultureFit: string;
      redFlags: string;
    };
    emailSent: 'approval' | 'rejection';
    emailPreview: {
      to: string;
      subject: string;
      body: string;
    };
    pipelineSteps: Array<{
      step: string;
      status: 'complete' | 'pending';
      durationMs: number;
    }>;
  };
};

// ── Custom Domains ─────────────────────────────────────────────────────

export type CustomDomain = {
  id: string;
  domain: string;
  status: 'pending_verification' | 'verified' | 'active' | 'failed' | 'removed';
  cnameTarget: string;
  sslStatus: string;
  verifiedAt: string | null;
  createdAt: string;
};

export const domains = {
  list: (operationId: string) =>
    api.get<{ operationId: string; domains: CustomDomain[] }>(
      `/api/operations/${operationId}/domains`,
    ),
  add: (operationId: string, domain: string) =>
    api.post<{
      ok: true;
      domainId: string;
      domain: string;
      cnameTarget: string;
      status: string;
      instructions: { step1: string; step2: string; step3: string };
    }>(`/api/operations/${operationId}/domains`, { domain }),
  verify: (operationId: string, domainId: string) =>
    api.post<{ ok: true; domain: string; status: string; sslStatus: string; message: string }>(
      `/api/operations/${operationId}/domains/${domainId}/verify`,
    ),
  remove: (operationId: string, domainId: string) =>
    api.del<{ ok: true; removed: true }>(
      `/api/operations/${operationId}/domains/${domainId}`,
    ),
};

// ── Code Export ────────────────────────────────────────────────────────

export type ExportBundle = {
  operationId: string;
  operationName: string;
  bundleVersion: number;
  generatedByModel: string;
  exportedAt: string;
  fileCount: number;
  totalBytes: number;
  files: Array<{ path: string; contents: string; sha256: string; argoGenerated: boolean; size: number }>;
  readme: string;
};

export const codeExport = {
  download: (operationId: string) =>
    api.get<ExportBundle>(`/api/operations/${operationId}/export`),
  pushToGithub: (
    operationId: string,
    input: { repoName: string; githubToken: string; branch?: string; commitMessage?: string },
  ) =>
    api.post<{
      ok: boolean;
      repoName: string;
      branch: string;
      filesPushed: number;
      filesTotal: number;
      errors: string[];
      repoUrl: string;
    }>(`/api/operations/${operationId}/export/github`, input),
};

// ── Data Browser ──────────────────────────────────────────────────────

export type DataCollection = {
  name: string;
  type: string;
  documentCount: number;
};

export const dataBrowser = {
  collections: (operationId: string) =>
    api.get<{
      operationId: string;
      database: string;
      collections: DataCollection[];
      totalCollections: number;
      totalDocuments: number;
    }>(`/api/operations/${operationId}/data/collections`),
  browse: (operationId: string, collection: string, params?: { page?: number; limit?: number; filter?: string }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.filter) qs.set('filter', params.filter);
    const suffix = qs.toString() ? `?${qs}` : '';
    return api.get<{
      operationId: string;
      collection: string;
      page: number;
      limit: number;
      totalCount: number;
      totalPages: number;
      documents: Array<Record<string, unknown>>;
    }>(`/api/operations/${operationId}/data/${collection}${suffix}`);
  },
  document: (operationId: string, collection: string, docId: string) =>
    api.get<{ operationId: string; collection: string; document: Record<string, unknown> }>(
      `/api/operations/${operationId}/data/${collection}/${docId}`,
    ),
};

// ── Usage Dashboard ───────────────────────────────────────────────────

export type UsageData = {
  period: { start: string; end: string; dayOfMonth: number; daysInMonth: number };
  totals: {
    invocations: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    totalCostUsd: number;
    projectedMonthlyCostUsd: number;
  };
  byModel: Array<{
    model: string;
    invocations: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    avgDurationMs: number;
    failures: number;
  }>;
  byOperation: Array<{
    operationId: string;
    operationName: string;
    invocations: number;
    costUsd: number;
  }>;
  daily: Array<{ date: string; invocations: number; tokens: number; costUsd: number }>;
};

export const usage = {
  get: () => api.get<UsageData>('/api/usage'),
};

// ── Studio ─────────────────────────────────────────────────────────────

export const studio = {
  detect: (description: string) =>
    api.post<StudioDetectResponse>('/api/studio/detect', { description }),
  build: (workflowType: string, answers: Record<string, string>) =>
    api.post<StudioBuildResponse>('/api/studio/build', { workflowType, answers }),
  simulate: (operationId: string, formData: Record<string, string>) =>
    api.post<StudioSimulateResponse>('/api/studio/simulate', { operationId, formData }),
};
