// 21st.dev Magic API client.
//
// 21st.dev is a curated marketplace of React UI components. Their public
// HTTP API at magic.21st.dev exposes three endpoints we care about:
//
//   POST /api/fetch-ui     - find existing components by description
//   POST /api/create-ui    - generate a brand-new component
//   POST /api/logo-search  - vector-search company logos
//
// Each returns { text: string } where the text is a runnable TSX snippet
// the build agent can drop into the bundle. Argo's build agent calls
// this client mid-stream when its specialist needs UI scaffolding it
// doesn't already know how to write.
//
// Auth: x-api-key header. Set TWENTY_FIRST_API_KEY in .env.local.
// Without a key the client returns null gracefully — builds keep going
// with the agent's own UI synthesis instead of crashing.

import { request } from 'undici';

const BASE_URL = process.env.TWENTY_FIRST_API_BASE ?? 'https://magic.21st.dev';

export interface TwentyFirstConfig {
  apiKey: string;
  apiBase: string;
  enabled: boolean;
}

export interface FetchUiResult {
  /** Raw TSX/JSX/MDX text the model can paste into a file. */
  text: string;
}

export interface LogoSearchResult {
  /** TSX/SVG snippet. */
  text: string;
}

export class TwentyFirstClient {
  constructor(private readonly cfg: TwentyFirstConfig) {}

  static fromEnv(): TwentyFirstClient {
    return new TwentyFirstClient({
      apiKey: process.env.TWENTY_FIRST_API_KEY ?? process.env.MAGIC_API_KEY ?? '',
      apiBase: BASE_URL,
      enabled: Boolean(process.env.TWENTY_FIRST_API_KEY ?? process.env.MAGIC_API_KEY),
    });
  }

  get isEnabled(): boolean {
    return this.cfg.enabled && this.cfg.apiKey.length > 0;
  }

  /**
   * Find an existing 21st.dev component matching the description.
   * Use a tight 2-4 word search query — that's what the API expects.
   */
  async fetchComponent(args: { message: string; searchQuery: string; signal?: AbortSignal }):
    Promise<FetchUiResult | null> {
    if (!this.isEnabled) return null;
    return this.post<FetchUiResult>('/api/fetch-ui', {
      message: args.message,
      searchQuery: args.searchQuery.split(/\s+/).slice(0, 4).join(' '),
    }, args.signal);
  }

  /**
   * Generate a brand-new component. Heavier than fetchComponent — only
   * call when the existing library doesn't have what we need.
   */
  async createComponent(args: { message: string; searchQuery: string; signal?: AbortSignal }):
    Promise<FetchUiResult | null> {
    if (!this.isEnabled) return null;
    return this.post<FetchUiResult>('/api/create-ui', {
      message: args.message,
      searchQuery: args.searchQuery,
    }, args.signal);
  }

  async logoSearch(args: { query: string; signal?: AbortSignal }): Promise<LogoSearchResult | null> {
    if (!this.isEnabled) return null;
    return this.post<LogoSearchResult>('/api/logo-search', {
      searchQuery: args.query,
    }, args.signal);
  }

  private async post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T | null> {
    try {
      const res = await request(`${this.cfg.apiBase}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.cfg.apiKey,
        },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
        bodyTimeout: 30_000,
        headersTimeout: 15_000,
      });
      if (res.statusCode >= 400) return null;
      return (await res.body.json()) as T;
    } catch {
      return null;
    }
  }
}
