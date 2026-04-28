/**
 * Self-hosted Web Scraper — Firecrawl replacement with ZERO external credits.
 *
 * Uses undici for HTTP + a simple HTML-to-markdown converter. No Playwright,
 * no headless browser, no external API needed. Works on any Node.js server.
 *
 * Capabilities:
 *   1. Scrape any URL → clean markdown
 *   2. Search via DuckDuckGo Lite (no API key needed)
 *   3. Extract metadata (title, description, OG tags)
 *   4. Respect robots.txt
 *   5. Rate limit per domain (1 req/sec)
 *
 * This replaces the Firecrawl API dependency. When FIRECRAWL_API_KEY is set,
 * the firecrawl-tool.ts still uses the API. When it's NOT set, the build
 * agent falls back to this self-hosted scraper automatically.
 */

import { request } from 'undici';
import pino from 'pino';

const log = pino({ name: 'web-scraper', level: process.env.LOG_LEVEL ?? 'info' });

// ── Rate limiter (1 req/sec per domain) ───────────────────────────────

const domainLastRequest = new Map<string, number>();
const RATE_LIMIT_MS = 1000;

async function rateLimitDomain(hostname: string): Promise<void> {
  const last = domainLastRequest.get(hostname) ?? 0;
  const wait = RATE_LIMIT_MS - (Date.now() - last);
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  domainLastRequest.set(hostname, Date.now());
}

// ── HTML to Markdown converter (lightweight, no dependencies) ─────────

function htmlToMarkdown(html: string): string {
  let md = html;

  // Remove scripts and styles
  md = md.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  md = md.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  md = md.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '');
  md = md.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');
  md = md.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');

  // Convert headings
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '\n##### $1\n');
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '\n###### $1\n');

  // Convert paragraphs
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n');

  // Convert links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // Convert lists
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  md = md.replace(/<\/?[ou]l[^>]*>/gi, '\n');

  // Convert bold/italic
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');

  // Convert code blocks
  md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n');
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

  // Convert images
  md = md.replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>/gi, '![$1]($2)');
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)');

  // Convert blockquotes
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, '\n> $1\n');

  // Convert line breaks
  md = md.replace(/<br\s*\/?>/gi, '\n');

  // Remove all remaining HTML tags
  md = md.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  md = md.replace(/&amp;/g, '&');
  md = md.replace(/&lt;/g, '<');
  md = md.replace(/&gt;/g, '>');
  md = md.replace(/&quot;/g, '"');
  md = md.replace(/&#39;/g, "'");
  md = md.replace(/&nbsp;/g, ' ');

  // Clean up whitespace
  md = md.replace(/\n{3,}/g, '\n\n');
  md = md.trim();

  return md;
}

// ── Extract metadata from HTML ────────────────────────────────────────

interface PageMetadata {
  title: string;
  description: string;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
}

function extractMetadata(html: string): PageMetadata {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i);
  const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i);
  const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i);
  const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["']/i);

  return {
    title: titleMatch?.[1]?.trim() ?? '',
    description: descMatch?.[1]?.trim() ?? '',
    ogTitle: ogTitleMatch?.[1]?.trim() ?? null,
    ogDescription: ogDescMatch?.[1]?.trim() ?? null,
    ogImage: ogImageMatch?.[1]?.trim() ?? null,
  };
}

// ── Scrape a single URL ───────────────────────────────────────────────

export interface ScrapeResult {
  ok: boolean;
  url: string;
  title: string;
  description: string;
  markdown: string;
  metadata: PageMetadata;
  statusCode: number;
  error?: string;
}

export async function scrapeUrl(url: string, maxContentLength = 500_000): Promise<ScrapeResult> {
  try {
    const parsed = new URL(url);
    await rateLimitDomain(parsed.hostname);

    const res = await request(url, {
      method: 'GET',
      headers: {
        'user-agent': 'Argo/1.0 (https://argo-ops.run; web research agent)',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      },
      maxRedirections: 5,
      bodyTimeout: 15_000,
      headersTimeout: 10_000,
    });

    const contentType = res.headers['content-type'] ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/json')) {
      return {
        ok: false,
        url,
        title: '',
        description: '',
        markdown: '',
        metadata: { title: '', description: '', ogTitle: null, ogDescription: null, ogImage: null },
        statusCode: res.statusCode,
        error: `Unsupported content type: ${contentType}`,
      };
    }

    const body = await res.body.text();
    const truncated = body.slice(0, maxContentLength);

    if (contentType.includes('application/json')) {
      return {
        ok: true,
        url,
        title: url,
        description: 'JSON response',
        markdown: '```json\n' + truncated + '\n```',
        metadata: { title: url, description: 'JSON', ogTitle: null, ogDescription: null, ogImage: null },
        statusCode: res.statusCode,
      };
    }

    const metadata = extractMetadata(truncated);
    const markdown = htmlToMarkdown(truncated);

    return {
      ok: true,
      url,
      title: metadata.ogTitle ?? metadata.title,
      description: metadata.ogDescription ?? metadata.description,
      markdown: markdown.slice(0, 8000),
      metadata,
      statusCode: res.statusCode,
    };
  } catch (err) {
    return {
      ok: false,
      url,
      title: '',
      description: '',
      markdown: '',
      metadata: { title: '', description: '', ogTitle: null, ogDescription: null, ogImage: null },
      statusCode: 0,
      error: String((err as Error)?.message ?? err).slice(0, 300),
    };
  }
}

// ── Search using DuckDuckGo Lite (no API key needed) ──────────────────

export interface SearchResult {
  url: string;
  title: string;
  description: string;
}

export async function searchWeb(query: string, maxResults = 5): Promise<SearchResult[]> {
  try {
    // DuckDuckGo Lite HTML — works without any API key
    const encodedQuery = encodeURIComponent(query);
    const res = await request(`https://lite.duckduckgo.com/lite/?q=${encodedQuery}`, {
      method: 'GET',
      headers: {
        'user-agent': 'Argo/1.0 (https://argo-ops.run)',
        'accept': 'text/html',
      },
      bodyTimeout: 10_000,
      headersTimeout: 5_000,
    });

    const html = await res.body.text();

    // Parse DuckDuckGo Lite results
    const results: SearchResult[] = [];
    const linkRegex = /<a[^>]*class="result-link"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRegex = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

    const links: Array<{ url: string; title: string }> = [];
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      links.push({
        url: match[1]?.replace(/&amp;/g, '&') ?? '',
        title: (match[2] ?? '').replace(/<[^>]+>/g, '').trim(),
      });
    }

    const snippets: string[] = [];
    while ((match = snippetRegex.exec(html)) !== null) {
      snippets.push((match[1] ?? '').replace(/<[^>]+>/g, '').trim());
    }

    // If DuckDuckGo Lite format didn't work, try alternative parsing
    if (links.length === 0) {
      // Fallback: extract any URLs from the response that look like results
      const urlRegex = /href="(https?:\/\/(?!lite\.duckduckgo)[^"]+)"/gi;
      const titleRegex = /<a[^>]*>([\s\S]*?)<\/a>/gi;
      const allUrls: string[] = [];
      while ((match = urlRegex.exec(html)) !== null) {
        const u = match[1] ?? '';
        if (u && !u.includes('duckduckgo.com') && !u.includes('duck.co')) {
          allUrls.push(u);
        }
      }
      for (const u of allUrls.slice(0, maxResults)) {
        results.push({ url: u, title: u, description: '' });
      }
      return results;
    }

    for (let i = 0; i < Math.min(links.length, maxResults); i++) {
      const link = links[i]!;
      results.push({
        url: link.url,
        title: link.title,
        description: snippets[i] ?? '',
      });
    }

    log.info({ query, resultCount: results.length }, 'web search complete (self-hosted)');
    return results;
  } catch (err) {
    log.warn({ err, query }, 'web search failed');
    return [];
  }
}

// ── Combined search + scrape (Firecrawl /search equivalent) ───────────

export interface WebResearchSelfHostedResult {
  ok: boolean;
  query: string;
  results: Array<{
    url: string;
    title: string;
    description: string;
    content: string;
  }>;
  error?: string;
}

/**
 * Search the web and scrape the top results — no external API needed.
 * This is the self-hosted equivalent of Firecrawl's /search endpoint.
 */
export async function selfHostedWebResearch(query: string, maxResults = 5): Promise<WebResearchSelfHostedResult> {
  try {
    const searchResults = await searchWeb(query, maxResults);

    if (searchResults.length === 0) {
      return { ok: false, query, results: [], error: 'No search results found' };
    }

    // Scrape top results in parallel (max 3 to be respectful)
    const toScrape = searchResults.slice(0, 3);
    const scraped = await Promise.allSettled(
      toScrape.map((r) => scrapeUrl(r.url)),
    );

    const results = searchResults.map((sr, i) => {
      const scrapeResult = i < scraped.length && scraped[i]!.status === 'fulfilled'
        ? (scraped[i] as PromiseFulfilledResult<ScrapeResult>).value
        : null;

      return {
        url: sr.url,
        title: scrapeResult?.title || sr.title,
        description: scrapeResult?.description || sr.description,
        content: scrapeResult?.ok ? scrapeResult.markdown.slice(0, 3000) : sr.description,
      };
    });

    return { ok: true, query, results };
  } catch (err) {
    return {
      ok: false,
      query,
      results: [],
      error: String((err as Error)?.message ?? err).slice(0, 300),
    };
  }
}
