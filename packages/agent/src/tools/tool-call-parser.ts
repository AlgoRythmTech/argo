// Tool-call parser.
//
// Build agents emit `<argo-tool name="..." ...>` tags inline in their
// streamed response. The build engine pauses, executes the tool, and
// re-prompts the model with the tool result rendered as markdown. This
// is the same pattern Bolt's `<boltAction type="shell">` and Replit
// Agent's tool calls use; we keep our own dialect so the dyad-* file
// vocabulary still parses cleanly.
//
// Supported tools:
//   <argo-tool name="fetch_21st_component" query="hero animated grid"
//              message="optional intent" />
//   <argo-tool name="create_21st_component" query="..." message="..." />
//   <argo-tool name="logo_search" query="vercel" />
//   <argo-tool name="browser_fetch" url="https://ui.shadcn.com/docs/installation" />
//
// All tags are SELF-CLOSING — the agent doesn't put a body inside.

export interface ToolCall {
  raw: string;
  /** Byte offset in the source string. Used for splice-replace. */
  start: number;
  end: number;
  name: string;
  attrs: Record<string, string>;
}

const TOOL_TAG = /<argo-tool\b([^>]*?)\/?>/g;
const ATTR_RE = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function findToolCalls(streamed: string): ToolCall[] {
  const out: ToolCall[] = [];
  TOOL_TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOOL_TAG.exec(streamed)) !== null) {
    const attrs: Record<string, string> = {};
    const attrSrc = m[1] ?? '';
    ATTR_RE.lastIndex = 0;
    let am: RegExpExecArray | null;
    while ((am = ATTR_RE.exec(attrSrc)) !== null) {
      const k = am[1]!;
      const v = am[2] ?? am[3] ?? '';
      attrs[k] = v;
    }
    if (!attrs.name) continue;
    out.push({
      raw: m[0],
      start: m.index,
      end: m.index + m[0].length,
      name: attrs.name,
      attrs,
    });
  }
  return out;
}

/**
 * Replace each tool-call tag with its rendered result, in-place. Returns
 * the new text. Used to feed the model a "you called X, here's what came
 * back" view in the next cycle's user-message.
 */
export function replaceToolCallsWithResults(
  streamed: string,
  results: Map<string, string>,
): string {
  const calls = findToolCalls(streamed);
  if (calls.length === 0) return streamed;
  let out = '';
  let cursor = 0;
  for (const c of calls) {
    out += streamed.slice(cursor, c.start);
    out += results.get(c.raw) ?? `<!-- tool ${c.name} returned no data -->`;
    cursor = c.end;
  }
  out += streamed.slice(cursor);
  return out;
}
