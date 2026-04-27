// Browser tool — allowlisted HTTP fetch the build agent can call mid-stream.
//
// Why: Replit Agent and Bolt both compose UIs by reading existing
// component libraries (shadcn/ui, Magic UI, 21st.dev). For Argo's
// specialist agents to match that quality, they need the same
// capability: "fetch this URL, return the text, let me crib the
// patterns I need."
//
// Safety: NEVER an open-ended fetch. Hard allowlist of domains:
//   - magic.21st.dev   — UI components
//   - 21st.dev         — public component pages
//   - registry.npmjs.org — package metadata
//   - raw.githubusercontent.com — known reference repos (shadcn etc.)
//   - api.github.com   — public file content
//   - ui.shadcn.com    — shadcn registry
//
// Any other host is rejected. Body responses are capped at 200 KB so
// a runaway page can't blow the build's token budget.

import { request } from 'undici';

const ALLOWED_HOSTS = new Set([
  'magic.21st.dev',
  '21st.dev',
  'registry.npmjs.org',
  'raw.githubusercontent.com',
  'api.github.com',
  'ui.shadcn.com',
]);

const MAX_RESPONSE_BYTES = 200 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

export interface BrowserFetchArgs {
  url: string;
  /** Pass-through headers (e.g. user-agent). NEVER include auth. */
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface BrowserFetchResult {
  ok: boolean;
  status: number;
  /** Always a string — JSON responses are JSON.stringify'd before return. */
  body: string;
  contentType: string | null;
  /** Truncated when the upstream body exceeded MAX_RESPONSE_BYTES. */
  truncated: boolean;
  /** Set when the fetch was rejected before hitting the wire. */
  error: string | null;
}

export async function browserFetch(args: BrowserFetchArgs): Promise<BrowserFetchResult> {
  let parsed: URL;
  try {
    parsed = new URL(args.url);
  } catch {
    return { ok: false, status: 0, body: '', contentType: null, truncated: false, error: 'invalid_url' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, status: 0, body: '', contentType: null, truncated: false, error: 'invalid_protocol' };
  }
  if (!ALLOWED_HOSTS.has(parsed.host)) {
    return {
      ok: false,
      status: 0,
      body: '',
      contentType: null,
      truncated: false,
      error: `host_not_allowed:${parsed.host}`,
    };
  }

  try {
    const res = await request(parsed.toString(), {
      method: 'GET',
      headers: {
        accept: 'application/json, text/plain, text/html, text/markdown, */*',
        'user-agent': 'argo-agent/0.1 (+https://argo.run)',
        ...(args.headers ?? {}),
      },
      ...(args.signal ? { signal: args.signal } : {}),
      bodyTimeout: FETCH_TIMEOUT_MS,
      headersTimeout: FETCH_TIMEOUT_MS,
      maxRedirections: 3,
    });

    const contentType = String(res.headers['content-type'] ?? '');
    let bytes = Buffer.alloc(0);
    let truncated = false;
    for await (const chunk of res.body) {
      bytes = Buffer.concat([bytes, chunk as Buffer]);
      if (bytes.length > MAX_RESPONSE_BYTES) {
        truncated = true;
        bytes = bytes.subarray(0, MAX_RESPONSE_BYTES);
        break;
      }
    }
    return {
      ok: res.statusCode < 400,
      status: res.statusCode,
      body: bytes.toString('utf8'),
      contentType,
      truncated,
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: '',
      contentType: null,
      truncated: false,
      error: String((err as Error)?.message ?? err).slice(0, 200),
    };
  }
}

/** Render a fetch result as a markdown block the agent can read in-prompt. */
export function renderFetchAsPromptSection(url: string, result: BrowserFetchResult): string {
  const lines: string[] = [];
  lines.push(`# Tool result: browser_fetch ${url}`);
  if (!result.ok) {
    lines.push(`Status: ${result.status} — error: ${result.error ?? 'http_error'}`);
    return lines.join('\n');
  }
  lines.push(`Status: ${result.status} · ${result.contentType ?? 'unknown content-type'}${result.truncated ? ' · TRUNCATED at 200 KB' : ''}`);
  lines.push('');
  // Wrap in a fence the model knows how to parse.
  const fence = result.contentType?.includes('json') ? 'json'
    : result.contentType?.includes('html') ? 'html'
    : result.contentType?.includes('markdown') ? 'md'
    : 'text';
  lines.push('```' + fence);
  lines.push(result.body);
  lines.push('```');
  return lines.join('\n');
}

export const BROWSER_TOOL_ALLOWLIST = Array.from(ALLOWED_HOSTS);
