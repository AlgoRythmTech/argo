// Dispatch a parsed <argo-tool> call to its handler and return the
// markdown the model will see in the next cycle.

import {
  browserFetch,
  renderFetchAsPromptSection,
  BROWSER_TOOL_ALLOWLIST,
} from './browser-tool.js';
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

let cachedTwentyFirst: TwentyFirstClient | null = null;
function getTwentyFirst(): TwentyFirstClient {
  if (!cachedTwentyFirst) cachedTwentyFirst = TwentyFirstClient.fromEnv();
  return cachedTwentyFirst;
}

export async function runToolCall(
  call: ToolCall,
  ctx: { signal?: AbortSignal } = {},
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

    default:
      return {
        ok: false,
        label: `unknown:${call.name}`,
        rendered: [
          `# Tool error: unknown tool "${call.name}"`,
          'Supported tools: fetch_21st_component, create_21st_component, logo_search, browser_fetch.',
          `Allowed browser_fetch hosts: ${BROWSER_TOOL_ALLOWLIST.join(', ')}.`,
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
