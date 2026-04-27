// SKILL.md frontmatter parser.
//
// Adapted from OpenClaw's hybrid line+YAML frontmatter parser
// (https://github.com/openclaw/openclaw, MIT, Copyright (c) 2025 Peter
// Steinberger). The original lives at src/markdown/frontmatter.ts. We
// kept the dual-path approach because real SKILL.md files mix simple
// scalar lines (the OpenAI-style `name: foo`) with structured YAML
// blocks (`metadata: { openclaw: { emoji: 🦞, requires: {...} } }`),
// and a single parser misses one or the other.
//
// Differences from the upstream:
//  - Argo emits a typed ParsedFrontmatter rather than only Record<string, string>;
//    we expose both string scalars AND the parsed structured payload, since
//    the runtime needs the structured object to load `inputSchema`.
//  - We removed OpenClaw-specific install/manifest fields. SKILL.md files
//    in Argo describe agent tools, not OS-level binaries, so we don't need
//    brew/uv/go install kinds.
//  - We removed `disable-model-invocation` / `user-invocable` fields —
//    Argo agents always invoke their own tools; per-tool gating happens at
//    runQualityGate rather than at skill-load time.

import YAML from 'yaml';

export interface ParsedFrontmatter {
  /** Flat string-scalar view — the simple line-format reading. */
  scalars: Record<string, string>;
  /** Full structured object from YAML.parse — preserves objects + arrays. */
  structured: Record<string, unknown>;
  /** Markdown body that follows the closing `---`. Empty string if none. */
  body: string;
}

interface ParsedFrontmatterLineEntry {
  value: string;
  kind: 'inline' | 'multiline';
  rawInline: string;
}

interface ParsedYamlValue {
  value: string;
  raw: unknown;
  kind: 'scalar' | 'structured';
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function coerceYamlValue(value: unknown): ParsedYamlValue | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    return { value: value.trim(), raw: value, kind: 'scalar' };
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return { value: String(value), raw: value, kind: 'scalar' };
  }
  if (typeof value === 'object') {
    try {
      return { value: JSON.stringify(value), raw: value, kind: 'structured' };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function parseYamlBlock(block: string): Record<string, ParsedYamlValue> | null {
  try {
    const parsed = YAML.parse(block, { schema: 'core' }) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const out: Record<string, ParsedYamlValue> = {};
    for (const [rawKey, value] of Object.entries(parsed as Record<string, unknown>)) {
      const key = rawKey.trim();
      if (!key) continue;
      const coerced = coerceYamlValue(value);
      if (!coerced) continue;
      out[key] = coerced;
    }
    return out;
  } catch {
    return null;
  }
}

function extractMultiLineValue(
  lines: string[],
  startIndex: number,
): { value: string; linesConsumed: number } {
  const out: string[] = [];
  let i = startIndex + 1;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.length > 0 && !line.startsWith(' ') && !line.startsWith('\t')) break;
    out.push(line);
    i += 1;
  }
  return { value: out.join('\n').trim(), linesConsumed: i - startIndex };
}

function parseLineBlock(block: string): Record<string, ParsedFrontmatterLineEntry> {
  const out: Record<string, ParsedFrontmatterLineEntry> = {};
  const lines = block.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (!m) {
      i += 1;
      continue;
    }
    const key = m[1] ?? '';
    const inlineValue = (m[2] ?? '').trim();
    if (!key) {
      i += 1;
      continue;
    }
    if (!inlineValue && i + 1 < lines.length) {
      const next = lines[i + 1] ?? '';
      if (next.startsWith(' ') || next.startsWith('\t')) {
        const { value, linesConsumed } = extractMultiLineValue(lines, i);
        if (value) out[key] = { value, kind: 'multiline', rawInline: inlineValue };
        i += linesConsumed;
        continue;
      }
    }
    const value = stripQuotes(inlineValue);
    if (value) out[key] = { value, kind: 'inline', rawInline: inlineValue };
    i += 1;
  }
  return out;
}

function isYamlBlockScalarIndicator(value: string): boolean {
  return /^[|>][+-]?(\d+)?[+-]?$/.test(value);
}

/**
 * Decide whether to prefer the line-form scalar over the YAML-parsed
 * structured value. This matters when a description contains a colon —
 * YAML may parse it as a nested map, but the author intended it as
 * plain prose.
 */
function preferLineValue(line: ParsedFrontmatterLineEntry, yaml: ParsedYamlValue): boolean {
  if (yaml.kind !== 'structured') return false;
  if (line.kind !== 'inline') return false;
  if (isYamlBlockScalarIndicator(line.rawInline)) return false;
  return line.value.includes(':');
}

function extractBlockAndBody(content: string): { block: string; body: string } | null {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized.startsWith('---')) return null;
  const endIndex = normalized.indexOf('\n---', 3);
  if (endIndex === -1) return null;
  const block = normalized.slice(4, endIndex);
  // body starts after the closing "---" line. endIndex points at the
  // newline before "---", so we advance past "\n---" and one optional newline.
  let bodyStart = endIndex + '\n---'.length;
  if (normalized[bodyStart] === '\n') bodyStart += 1;
  return { block, body: normalized.slice(bodyStart) };
}

/**
 * Parse the YAML frontmatter at the top of a SKILL.md (or any markdown)
 * file and return both the flat scalar view and the full structured
 * object, plus the body that follows.
 *
 * Returns empty values if no frontmatter is present — the caller decides
 * whether that's an error.
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  const extracted = extractBlockAndBody(content);
  if (!extracted) return { scalars: {}, structured: {}, body: content };

  const linesParsed = parseLineBlock(extracted.block);
  const yamlParsed = parseYamlBlock(extracted.block);

  const scalars: Record<string, string> = {};
  const structured: Record<string, unknown> = {};

  if (yamlParsed === null) {
    for (const [k, e] of Object.entries(linesParsed)) {
      scalars[k] = e.value;
      structured[k] = e.value;
    }
    return { scalars, structured, body: extracted.body };
  }

  for (const [key, yamlValue] of Object.entries(yamlParsed)) {
    const lineEntry = linesParsed[key];
    if (lineEntry && preferLineValue(lineEntry, yamlValue)) {
      scalars[key] = lineEntry.value;
      structured[key] = lineEntry.value;
    } else {
      scalars[key] = yamlValue.value;
      structured[key] = yamlValue.raw;
    }
  }
  for (const [key, lineEntry] of Object.entries(linesParsed)) {
    if (!(key in scalars)) {
      scalars[key] = lineEntry.value;
      structured[key] = lineEntry.value;
    }
  }

  return { scalars, structured, body: extracted.body };
}
