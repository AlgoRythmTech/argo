// Syntax-error repair loop.
//
// When the build engine's bundle_syntax_valid check flags one or more
// files as un-parseable, we don't want to bail and force the user to
// re-prompt. Instead we run ONE targeted repair pass: send the broken
// files + the parser's exact error to a small/cheap model and ask for
// corrected replacements. The model produces files only — no prose, no
// diagnosis. The build pipeline then re-runs the gate; if syntax is now
// valid the deploy continues, otherwise we surface the failure cleanly.
//
// Constraints:
//   - One iteration only. The model has shown it can write parseable JS;
//     if it can't fix a syntax error in one shot something deeper is
//     wrong (a runaway template literal, an embedded null byte, etc.)
//     and we want a human in the loop.
//   - Cheap model: classifier tier (gpt-4o-mini class). The full
//     architect/builder is overkill for "close this brace".
//   - Whole-file replacement: surgical patches need positional precision
//     that the model is bad at when the file is already syntactically
//     broken (line numbers shift mid-fix). Whole-file is safer.

import { z } from 'zod';
import { request } from 'undici';
import { routeModel } from '../llm/model-router.js';

export interface SyntaxBreak {
  path: string;
  /** The broken contents. */
  contents: string;
  /** The parser error. Comes from the build-engine's bundle_syntax_valid check. */
  parserError: string;
  /** 1-based line, when the parser provided one. */
  parserErrorLine: number | null;
}

export interface SyntaxRepairResult {
  /** Repaired files keyed by path. Files the model declined to fix are absent. */
  fixed: Record<string, string>;
  /** Per-file outcome: 'fixed' | 'unchanged' | 'declined' | 'still_broken'. */
  outcomes: Array<{
    path: string;
    outcome: 'fixed' | 'unchanged' | 'declined' | 'still_broken';
    note?: string;
  }>;
  /** The model the router actually picked, for cost ledger correlation. */
  modelUsed: string;
  /** ms wall-clock for the repair pass. */
  durationMs: number;
}

const RepairResponse = z.object({
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        // Empty string means "I refuse to fix" (e.g. file is salvageable).
        replacement: z.string(),
        reason: z.string().min(2).max(280),
      }),
    )
    .max(40),
});

const SYSTEM_PROMPT = `You are Argo's syntax-repair agent. The build engine has flagged one or more files as syntactically broken. Your job is to return CORRECTED file contents that parse cleanly.

Rules:
- Output JSON matching the schema { files: [{ path, replacement, reason }] }
- Each replacement is the COMPLETE corrected file (not a diff or patch)
- Preserve every comment, import, export, function, and behavior exactly — only fix the syntax
- Do NOT add features, refactor, or change semantics
- Do NOT change file names, only fix the contents
- If you genuinely cannot fix a file (e.g. it would require semantic guesses), set replacement to "" and explain in reason
- The reason field is one sentence describing the fix (e.g. "removed stray comma at line 14")`;

/**
 * Run one repair pass over the syntactically-broken files.
 *
 * Returns the patched contents keyed by path. The caller is expected to
 * splice these into the bundle and re-run the quality gate. Files the
 * model declined to fix (or files where the response was empty) are
 * absent from `fixed` — the caller should leave them as-is and let the
 * gate fail loudly.
 */
export async function repairSyntaxErrors(args: {
  breaks: SyntaxBreak[];
  /** Override the LLM endpoint. Defaults to the OpenAI-compatible router URL. */
  apiBaseUrl?: string;
  apiKey?: string;
  /** Per-call timeout (default 45s). Repair should be fast. */
  timeoutMs?: number;
}): Promise<SyntaxRepairResult> {
  if (args.breaks.length === 0) {
    return { fixed: {}, outcomes: [], modelUsed: '', durationMs: 0 };
  }

  const start = Date.now();
  const routing = routeModel('classifier');
  const model = routing.primary;
  const userMessage = renderRepairPrompt(args.breaks);

  const apiBase = args.apiBaseUrl ?? process.env.OPENAI_API_BASE ?? 'https://api.openai.com/v1';
  const apiKey = args.apiKey ?? process.env.OPENAI_API_KEY ?? '';
  if (!apiKey) {
    return {
      fixed: {},
      outcomes: args.breaks.map((b) => ({ path: b.path, outcome: 'declined', note: 'no_api_key' })),
      modelUsed: model,
      durationMs: Date.now() - start,
    };
  }

  let response: Awaited<ReturnType<typeof request>>;
  try {
    response = await request(`${apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
      }),
      bodyTimeout: args.timeoutMs ?? 45_000,
      headersTimeout: args.timeoutMs ?? 45_000,
    });
  } catch (err) {
    return {
      fixed: {},
      outcomes: args.breaks.map((b) => ({
        path: b.path,
        outcome: 'declined',
        note: 'llm_request_failed: ' + String((err as Error).message ?? err).slice(0, 140),
      })),
      modelUsed: model,
      durationMs: Date.now() - start,
    };
  }

  if (response.statusCode !== 200) {
    const body = await response.body.text();
    return {
      fixed: {},
      outcomes: args.breaks.map((b) => ({
        path: b.path,
        outcome: 'declined',
        note: `llm_${response.statusCode}: ${body.slice(0, 140)}`,
      })),
      modelUsed: model,
      durationMs: Date.now() - start,
    };
  }

  const body = (await response.body.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = body.choices?.[0]?.message?.content ?? '';
  let parsed: z.infer<typeof RepairResponse>;
  try {
    parsed = RepairResponse.parse(JSON.parse(raw));
  } catch {
    return {
      fixed: {},
      outcomes: args.breaks.map((b) => ({
        path: b.path,
        outcome: 'declined',
        note: 'llm_response_unparseable',
      })),
      modelUsed: model,
      durationMs: Date.now() - start,
    };
  }

  const fixed: Record<string, string> = {};
  const outcomes: SyntaxRepairResult['outcomes'] = [];
  const seen = new Set<string>();
  for (const file of parsed.files) {
    seen.add(file.path);
    const original = args.breaks.find((b) => b.path === file.path);
    if (!original) {
      // Model produced a file we didn't ask about — ignore.
      continue;
    }
    if (file.replacement.length === 0) {
      outcomes.push({ path: file.path, outcome: 'declined', note: file.reason });
      continue;
    }
    if (file.replacement === original.contents) {
      outcomes.push({ path: file.path, outcome: 'unchanged', note: file.reason });
      continue;
    }
    fixed[file.path] = file.replacement;
    outcomes.push({ path: file.path, outcome: 'fixed', note: file.reason });
  }
  // Anything we asked about and didn't get back — mark declined.
  for (const b of args.breaks) {
    if (!seen.has(b.path)) {
      outcomes.push({ path: b.path, outcome: 'declined', note: 'missing_from_response' });
    }
  }

  return { fixed, outcomes, modelUsed: model, durationMs: Date.now() - start };
}

function renderRepairPrompt(breaks: SyntaxBreak[]): string {
  const out: string[] = [];
  out.push(
    `The following ${breaks.length} file(s) failed to parse. Return corrected contents in the JSON format specified.`,
  );
  out.push('');
  for (const b of breaks) {
    out.push(`## ${b.path}`);
    out.push(`Parser error: ${b.parserError}`);
    if (b.parserErrorLine !== null) out.push(`Reported line: ${b.parserErrorLine}`);
    out.push('');
    out.push('```');
    // Cap each file at 8000 chars to keep the request size sane; the model
    // sees the head + tail with a marker if truncated.
    if (b.contents.length > 8000) {
      out.push(b.contents.slice(0, 4000));
      out.push(`\n/* … ${b.contents.length - 8000} chars elided … */\n`);
      out.push(b.contents.slice(-4000));
    } else {
      out.push(b.contents);
    }
    out.push('```');
    out.push('');
  }
  return out.join('\n');
}
