/**
 * Firecrawl tool — gives Argo's build agents access to live web data.
 *
 * Why this matters: LLMs generate code based on training data that's
 * months old. APIs change. Libraries update. Best practices evolve.
 * When the agent needs to integrate with a specific API (Stripe v2026,
 * Supabase edge functions, a customer's existing API), it can now
 * RESEARCH the current docs instead of guessing from training data.
 *
 * Use cases during code generation:
 *   1. Look up current API documentation
 *   2. Find integration examples for a specific service
 *   3. Research competitor features for inspiration
 *   4. Verify npm package names and latest versions
 *   5. Find design patterns and UI examples
 *
 * This tool is available to the build agent via <argo-tool name="web_research">.
 */

import { request } from 'undici';
import pino from 'pino';

const log = pino({ name: 'firecrawl-tool', level: process.env.LOG_LEVEL ?? 'info' });
const FIRECRAWL_API_BASE = 'https://api.firecrawl.dev/v1';

export interface WebResearchResult {
  ok: boolean;
  query: string;
  results: Array<{
    url: string;
    title: string;
    description: string;
    content: string; // Markdown content, truncated
  }>;
  error?: string;
}

/**
 * Search the web and return clean, structured results.
 * Used by the build agent when it encounters an <argo-tool name="web_research"> tag.
 */
export async function webResearch(query: string, limit = 5): Promise<WebResearchResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY ?? '';
  if (!apiKey) {
    return {
      ok: false,
      query,
      results: [],
      error: 'FIRECRAWL_API_KEY not configured — web research unavailable.',
    };
  }

  try {
    const res = await request(`${FIRECRAWL_API_BASE}/search`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        query,
        limit,
        scrapeOptions: { formats: ['markdown'] },
      }),
      bodyTimeout: 30_000,
    });

    const text = await res.body.text();
    if (res.statusCode >= 400) {
      log.warn({ status: res.statusCode, query }, 'firecrawl search failed');
      return { ok: false, query, results: [], error: `Firecrawl returned ${res.statusCode}` };
    }

    const data = JSON.parse(text) as {
      data?: Array<{
        url?: string;
        title?: string;
        description?: string;
        markdown?: string;
      }>;
    };

    const results = (data.data ?? []).map((r) => ({
      url: r.url ?? '',
      title: r.title ?? '',
      description: r.description ?? '',
      content: (r.markdown ?? '').slice(0, 3000), // Cap content to save tokens
    }));

    log.info({ query, resultCount: results.length }, 'web research complete');

    return { ok: true, query, results };
  } catch (err) {
    log.warn({ err, query }, 'web research crashed');
    return {
      ok: false,
      query,
      results: [],
      error: String((err as Error)?.message ?? err).slice(0, 200),
    };
  }
}

/**
 * Scrape a single URL and return its content as markdown.
 */
export async function webScrape(url: string): Promise<{ ok: boolean; content: string; error?: string }> {
  const apiKey = process.env.FIRECRAWL_API_KEY ?? '';
  if (!apiKey) {
    return { ok: false, content: '', error: 'FIRECRAWL_API_KEY not configured' };
  }

  try {
    const res = await request(`${FIRECRAWL_API_BASE}/scrape`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
      }),
      bodyTimeout: 30_000,
    });

    const text = await res.body.text();
    if (res.statusCode >= 400) {
      return { ok: false, content: '', error: `Firecrawl scrape returned ${res.statusCode}` };
    }

    const data = JSON.parse(text) as { data?: { markdown?: string } };
    const content = (data.data?.markdown ?? '').slice(0, 8000);

    return { ok: true, content };
  } catch (err) {
    return { ok: false, content: '', error: String((err as Error)?.message ?? err).slice(0, 200) };
  }
}

/**
 * Render web research results as a prompt section the build agent can consume.
 */
export function renderWebResearchAsPromptSection(result: WebResearchResult): string {
  if (!result.ok) {
    return `# Tool result: web_research (failed)\nQuery: "${result.query}"\nError: ${result.error ?? 'unknown'}`;
  }

  const lines: string[] = [
    `# Tool result: web_research`,
    `Query: "${result.query}"`,
    `Found ${result.results.length} results:`,
    '',
  ];

  for (const r of result.results) {
    lines.push(`## ${r.title}`);
    lines.push(`URL: ${r.url}`);
    if (r.description) lines.push(`> ${r.description}`);
    lines.push('');
    if (r.content) {
      lines.push(r.content.slice(0, 1500));
      if (r.content.length > 1500) lines.push('...(truncated)');
    }
    lines.push('');
  }

  return lines.join('\n');
}
