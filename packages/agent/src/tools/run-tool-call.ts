// Dispatch a parsed <argo-tool> call to its handler and return the
// markdown the model will see in the next cycle.

import {
  browserFetch,
  renderFetchAsPromptSection,
  BROWSER_TOOL_ALLOWLIST,
} from './browser-tool.js';
import {
  runSandboxExec,
  renderSandboxExecAsPromptSection,
  SANDBOX_EXEC_ALLOWED_BINARIES,
} from './sandbox-exec-tool.js';
import {
  webResearch,
  webScrape,
  renderWebResearchAsPromptSection,
} from './firecrawl-tool.js';
import { TwentyFirstClient } from './twentyfirst-client.js';
import type { ToolCall } from './tool-call-parser.js';

export interface ToolExecutionResult {
  /** Markdown to substitute back into the streamed text. */
  rendered: string;
  /** True if the tool returned a usable payload. */
  ok: boolean;
  /** Short label for telemetry / logs. */
  label: string;
}

export interface ToolCallContext {
  signal?: AbortSignal;
  /**
   * Current bundle files keyed by relative path. Populated by the
   * stream wrapper so sandbox_exec can run against the in-progress
   * source tree without a separate disk write step.
   */
  currentFiles?: ReadonlyMap<string, string>;
}

let cachedTwentyFirst: TwentyFirstClient | null = null;
function getTwentyFirst(): TwentyFirstClient {
  if (!cachedTwentyFirst) cachedTwentyFirst = TwentyFirstClient.fromEnv();
  return cachedTwentyFirst;
}

export async function runToolCall(
  call: ToolCall,
  ctx: ToolCallContext = {},
): Promise<ToolExecutionResult> {
  switch (call.name) {
    case 'fetch_21st_component': {
      const client = getTwentyFirst();
      if (!client.isEnabled) {
        return offline('fetch_21st_component', 'TWENTY_FIRST_API_KEY missing — synthesising the component locally.');
      }
      const query = call.attrs.query ?? call.attrs.searchQuery ?? '';
      const message = call.attrs.message ?? query;
      if (!query) return badRequest('fetch_21st_component', 'missing query attribute');
      const res = await client.fetchComponent({ message, searchQuery: query, ...(ctx.signal ? { signal: ctx.signal } : {}) });
      if (!res) return offline('fetch_21st_component', `21st.dev returned nothing for "${query}".`);
      return {
        ok: true,
        label: `21st.dev:fetch:${query}`,
        rendered: ['# Tool result: fetch_21st_component', `Query: \`${query}\``, '', '```tsx', res.text, '```'].join('\n'),
      };
    }

    case 'create_21st_component': {
      const client = getTwentyFirst();
      if (!client.isEnabled) {
        return offline('create_21st_component', 'TWENTY_FIRST_API_KEY missing — synthesising the component locally.');
      }
      const query = call.attrs.query ?? '';
      const message = call.attrs.message ?? query;
      if (!query) return badRequest('create_21st_component', 'missing query attribute');
      const res = await client.createComponent({ message, searchQuery: query, ...(ctx.signal ? { signal: ctx.signal } : {}) });
      if (!res) return offline('create_21st_component', `21st.dev didn't generate a component for "${query}".`);
      return {
        ok: true,
        label: `21st.dev:create:${query}`,
        rendered: ['# Tool result: create_21st_component', `Brief: \`${message}\``, '', '```tsx', res.text, '```'].join('\n'),
      };
    }

    case 'logo_search': {
      const client = getTwentyFirst();
      if (!client.isEnabled) return offline('logo_search', 'TWENTY_FIRST_API_KEY missing.');
      const query = call.attrs.query ?? '';
      if (!query) return badRequest('logo_search', 'missing query attribute');
      const res = await client.logoSearch({ query, ...(ctx.signal ? { signal: ctx.signal } : {}) });
      if (!res) return offline('logo_search', `No logo found for "${query}".`);
      return {
        ok: true,
        label: `21st.dev:logo:${query}`,
        rendered: ['# Tool result: logo_search', `Query: ${query}`, '', '```tsx', res.text, '```'].join('\n'),
      };
    }

    case 'browser_fetch': {
      const url = call.attrs.url ?? '';
      if (!url) return badRequest('browser_fetch', 'missing url attribute');
      const res = await browserFetch({ url, ...(ctx.signal ? { signal: ctx.signal } : {}) });
      return {
        ok: res.ok,
        label: `browser:${url}`,
        rendered: renderFetchAsPromptSection(url, res),
      };
    }

    case 'sandbox_exec': {
      const command = call.attrs.command ?? '';
      if (!command) return badRequest('sandbox_exec', 'missing command attribute');
      if (!ctx.currentFiles) {
        return offline('sandbox_exec', 'no bundle context available — sandbox_exec only works inside the build engine streaming loop.');
      }
      const res = await runSandboxExec({
        command,
        files: ctx.currentFiles,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
      return {
        ok: res.ok,
        label: `exec:${command}`,
        rendered: renderSandboxExecAsPromptSection(command, res),
      };
    }

    case 'web_research': {
      const query = call.attrs.query ?? '';
      if (!query) return badRequest('web_research', 'missing query attribute');
      const limit = call.attrs.limit ? parseInt(call.attrs.limit, 10) : 5;
      const res = await webResearch(query, limit);
      return {
        ok: res.ok,
        label: `web_research:${query}`,
        rendered: renderWebResearchAsPromptSection(res),
      };
    }

    case 'web_scrape': {
      const url = call.attrs.url ?? '';
      if (!url) return badRequest('web_scrape', 'missing url attribute');
      const res = await webScrape(url);
      return {
        ok: res.ok,
        label: `web_scrape:${url}`,
        rendered: res.ok
          ? `# Tool result: web_scrape\nURL: ${url}\n\n${res.content}`
          : `# Tool result: web_scrape (failed)\nURL: ${url}\nError: ${res.error}`,
      };
    }

    default:
      return {
        ok: false,
        label: `unknown:${call.name}`,
        rendered: [
          `# Tool error: unknown tool "${call.name}"`,
          'Supported tools: fetch_21st_component, create_21st_component, logo_search, browser_fetch, sandbox_exec, web_research, web_scrape.',
          `Allowed browser_fetch hosts: ${BROWSER_TOOL_ALLOWLIST.join(', ')}.`,
          `Allowed sandbox_exec binaries: ${SANDBOX_EXEC_ALLOWED_BINARIES.join(', ')}.`,
        ].join('\n'),
      };
  }
}

function offline(name: string, why: string): ToolExecutionResult {
  return {
    ok: false,
    label: `offline:${name}`,
    rendered: ['# Tool result: ' + name + ' (skipped)', why].join('\n'),
  };
}

function badRequest(name: string, why: string): ToolExecutionResult {
  return {
    ok: false,
    label: `bad_request:${name}`,
    rendered: ['# Tool error: ' + name, why].join('\n'),
  };
}
