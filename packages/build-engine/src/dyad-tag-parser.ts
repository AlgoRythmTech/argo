// argo:upstream dyad@9dbc063 — src/ipc/processors/response_processor.ts
// (Apache-2.0). Patterns for parsing the dyad-* tag vocabulary out of a
// streaming model response. Adapted to be transport-agnostic (Argo runs
// hosted, not Electron) and to feed our IExecutionProvider.deploy() bundle.

import { sha256OfString } from './bundle-builder.js';

export interface ParsedWriteAction {
  kind: 'write';
  path: string;
  description: string | null;
  contents: string;
}

export interface ParsedRenameAction {
  kind: 'rename';
  from: string;
  to: string;
}

export interface ParsedDeleteAction {
  kind: 'delete';
  path: string;
}

export interface ParsedAddDependencyAction {
  kind: 'add-dependency';
  packages: string[];
}

export interface ParsedCommandAction {
  kind: 'command';
  command: 'rebuild' | 'restart' | 'refresh';
}

export interface ParsedChatSummaryAction {
  kind: 'chat-summary';
  summary: string;
}

/**
 * Surgical patch — the str_replace pattern Anthropic's text_editor tool uses.
 * Saves ~50% of re-prompt token cost vs full file rewrites and reduces the
 * regression risk of "model rewrote unrelated lines while fixing one."
 *
 *   <dyad-patch path="server.js">
 *   <find>app.register(rateLimit, { global: false, max: 60 });</find>
 *   <replace>app.register(rateLimit, { global: false, max: 60, timeWindow: '1 minute' });</replace>
 *   </dyad-patch>
 *
 * The `find` block must match EXACTLY one occurrence in the target file.
 * Zero matches → the patch is rejected and surfaced as a quality-gate
 * failure. Multiple matches → also rejected (require the model to add
 * surrounding context).
 */
export interface ParsedPatchAction {
  kind: 'patch';
  path: string;
  find: string;
  replace: string;
}

export type ParsedAction =
  | ParsedWriteAction
  | ParsedRenameAction
  | ParsedDeleteAction
  | ParsedAddDependencyAction
  | ParsedCommandAction
  | ParsedChatSummaryAction
  | ParsedPatchAction;

export interface ParseResult {
  actions: ParsedAction[];
  /** Human-readable text outside of any tag — preserved for the chat surface. */
  prose: string;
  /** True if the response ends with an unclosed <dyad-write> tag. */
  hasUnclosedWrite: boolean;
}

const WRITE_OPEN = /<dyad-write\b([^>]*)>/g;
const WRITE_CLOSE = /<\/dyad-write>/;
const PATCH_OPEN = /<dyad-patch\b([^>]*)>/g;
const PATCH_CLOSE = /<\/dyad-patch>/;
const RENAME = /<dyad-rename\b([^>]*)\/?>(?:<\/dyad-rename>)?/g;
const DELETE = /<dyad-delete\b([^>]*)\/?>(?:<\/dyad-delete>)?/g;
const ADD_DEP = /<dyad-add-dependency\b([^>]*)\/?>(?:<\/dyad-add-dependency>)?/g;
const COMMAND = /<dyad-command\b([^>]*)\/?>(?:<\/dyad-command>)?/g;
const CHAT_SUMMARY = /<dyad-chat-summary\b[^>]*>([\s\S]*?)<\/dyad-chat-summary>/g;

const ATTR = (name: string) =>
  new RegExp(`${name}\\s*=\\s*"([^"]*)"|${name}\\s*=\\s*'([^']*)'`, 'i');

function attr(raw: string, name: string): string | null {
  const m = raw.match(ATTR(name));
  if (!m) return null;
  return m[1] ?? m[2] ?? null;
}

export function parseDyadResponse(streamed: string): ParseResult {
  const actions: ParsedAction[] = [];

  // 1. Write blocks (have a body so are parsed differently).
  const writeRanges: Array<[number, number]> = [];
  WRITE_OPEN.lastIndex = 0;
  let openMatch: RegExpExecArray | null;
  while ((openMatch = WRITE_OPEN.exec(streamed)) !== null) {
    const openStart = openMatch.index;
    const openEnd = openMatch.index + openMatch[0].length;
    const after = streamed.slice(openEnd);
    const closeMatch = after.match(WRITE_CLOSE);
    if (!closeMatch || typeof closeMatch.index !== 'number') {
      // Unclosed — caller can decide to wait for more chunks.
      continue;
    }
    const bodyStart = openEnd;
    const bodyEnd = openEnd + closeMatch.index;
    const blockEnd = bodyEnd + '</dyad-write>'.length;
    const path = attr(openMatch[1] ?? '', 'path');
    const description = attr(openMatch[1] ?? '', 'description');
    if (!path) continue;
    actions.push({
      kind: 'write',
      path,
      description,
      contents: streamed.slice(bodyStart, bodyEnd).replace(/^\n/, '').replace(/\n$/, ''),
    });
    writeRanges.push([openStart, blockEnd]);
  }

  // 1b. Patch blocks — surgical str_replace edits.
  const patchRanges: Array<[number, number]> = [];
  PATCH_OPEN.lastIndex = 0;
  let patchMatch: RegExpExecArray | null;
  while ((patchMatch = PATCH_OPEN.exec(streamed)) !== null) {
    const openStart = patchMatch.index;
    const openEnd = patchMatch.index + patchMatch[0].length;
    const after = streamed.slice(openEnd);
    const closeMatch = after.match(PATCH_CLOSE);
    if (!closeMatch || typeof closeMatch.index !== 'number') continue;
    const bodyEnd = openEnd + closeMatch.index;
    const blockEnd = bodyEnd + '</dyad-patch>'.length;
    const path = attr(patchMatch[1] ?? '', 'path');
    if (!path) continue;
    const body = streamed.slice(openEnd, bodyEnd);
    const findMatch = body.match(/<find>([\s\S]*?)<\/find>/);
    const replaceMatch = body.match(/<replace>([\s\S]*?)<\/replace>/);
    if (!findMatch || !replaceMatch) continue;
    actions.push({
      kind: 'patch',
      path,
      find: findMatch[1] ?? '',
      replace: replaceMatch[1] ?? '',
    });
    patchRanges.push([openStart, blockEnd]);
  }

  // 2. Self-closing actions.
  const collectSelfClosing = <T extends ParsedAction>(
    re: RegExp,
    build: (raw: string) => T | null,
  ): Array<[number, number, T]> => {
    const out: Array<[number, number, T]> = [];
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(streamed)) !== null) {
      const action = build(m[1] ?? '');
      if (!action) continue;
      out.push([m.index, m.index + m[0].length, action]);
    }
    return out;
  };

  const renames = collectSelfClosing<ParsedRenameAction>(RENAME, (raw) => {
    const from = attr(raw, 'from');
    const to = attr(raw, 'to');
    if (!from || !to) return null;
    return { kind: 'rename', from, to };
  });
  const deletes = collectSelfClosing<ParsedDeleteAction>(DELETE, (raw) => {
    const path = attr(raw, 'path');
    if (!path) return null;
    return { kind: 'delete', path };
  });
  const addDeps = collectSelfClosing<ParsedAddDependencyAction>(ADD_DEP, (raw) => {
    const packages = (attr(raw, 'packages') ?? '').split(/\s+/).filter(Boolean);
    if (packages.length === 0) return null;
    return { kind: 'add-dependency', packages };
  });
  const commands = collectSelfClosing<ParsedCommandAction>(COMMAND, (raw) => {
    const t = (attr(raw, 'type') ?? '').toLowerCase();
    if (t !== 'rebuild' && t !== 'restart' && t !== 'refresh') return null;
    return { kind: 'command', command: t };
  });

  for (const [, , action] of [...renames, ...deletes, ...addDeps, ...commands]) {
    actions.push(action);
  }

  // 3. Chat summary — last one wins.
  const summaries: Array<[number, number, ParsedChatSummaryAction]> = [];
  CHAT_SUMMARY.lastIndex = 0;
  let s: RegExpExecArray | null;
  while ((s = CHAT_SUMMARY.exec(streamed)) !== null) {
    summaries.push([
      s.index,
      s.index + s[0].length,
      { kind: 'chat-summary', summary: (s[1] ?? '').trim() },
    ]);
  }
  if (summaries.length > 0) {
    actions.push(summaries[summaries.length - 1]![2]);
  }

  // 4. Prose = streamed minus all tag ranges.
  const allRanges = [
    ...writeRanges,
    ...patchRanges,
    ...renames.map(([a, b]) => [a, b] as [number, number]),
    ...deletes.map(([a, b]) => [a, b] as [number, number]),
    ...addDeps.map(([a, b]) => [a, b] as [number, number]),
    ...commands.map(([a, b]) => [a, b] as [number, number]),
    ...summaries.map(([a, b]) => [a, b] as [number, number]),
  ].sort((a, b) => a[0] - b[0]);

  let prose = '';
  let cursor = 0;
  for (const [start, end] of allRanges) {
    if (start > cursor) prose += streamed.slice(cursor, start);
    cursor = Math.max(cursor, end);
  }
  prose += streamed.slice(cursor);
  prose = prose.replace(/\n{3,}/g, '\n\n').trim();

  // 5. Detect unclosed write at the tail.
  WRITE_OPEN.lastIndex = 0;
  let lastOpen: RegExpExecArray | null = null;
  let candidate: RegExpExecArray | null;
  while ((candidate = WRITE_OPEN.exec(streamed)) !== null) {
    lastOpen = candidate;
  }
  let hasUnclosedWrite = false;
  if (lastOpen) {
    const after = streamed.slice(lastOpen.index + lastOpen[0].length);
    if (!WRITE_CLOSE.test(after)) hasUnclosedWrite = true;
  }

  return { actions, prose, hasUnclosedWrite };
}

/**
 * Apply parsed actions to an in-memory file map. Argo's runtime is hosted
 * (not Electron), so we don't write to disk — we accumulate the changes in
 * a Map<path, contents> that the build engine then bundles for Blaxel.
 */
export interface PatchFailure {
  path: string;
  reason: 'file_not_found' | 'find_no_match' | 'find_multi_match' | 'find_empty';
  /** First 120 chars of the find string, for error messages. */
  findPreview: string;
}

export function applyActionsToFileMap(
  current: Map<string, string>,
  actions: ParsedAction[],
): {
  files: Map<string, string>;
  added: string[];
  modified: string[];
  removed: string[];
  renamed: Array<{ from: string; to: string }>;
  newDependencies: string[];
  commands: ParsedCommandAction['command'][];
  summary: string | null;
  /** Patches that couldn't be applied — surfaced to the auto-fix loop. */
  patchFailures: PatchFailure[];
} {
  const files = new Map(current);
  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];
  const renamed: Array<{ from: string; to: string }> = [];
  const newDependencies: string[] = [];
  const commands: ParsedCommandAction['command'][] = [];
  const patchFailures: PatchFailure[] = [];
  let summary: string | null = null;

  for (const action of actions) {
    switch (action.kind) {
      case 'write': {
        const existed = files.has(action.path);
        files.set(action.path, action.contents);
        (existed ? modified : added).push(action.path);
        break;
      }
      case 'patch': {
        const result = applyPatch(files.get(action.path), action.find, action.replace);
        if (result.ok) {
          files.set(action.path, result.contents);
          if (!modified.includes(action.path)) modified.push(action.path);
        } else {
          patchFailures.push({
            path: action.path,
            reason: result.reason,
            findPreview: action.find.replace(/\s+/g, ' ').slice(0, 120),
          });
        }
        break;
      }
      case 'rename': {
        const contents = files.get(action.from);
        if (contents === undefined) break;
        files.delete(action.from);
        files.set(action.to, contents);
        renamed.push({ from: action.from, to: action.to });
        break;
      }
      case 'delete': {
        if (files.delete(action.path)) removed.push(action.path);
        break;
      }
      case 'add-dependency':
        newDependencies.push(...action.packages);
        break;
      case 'command':
        commands.push(action.command);
        break;
      case 'chat-summary':
        summary = action.summary;
        break;
    }
  }

  return { files, added, modified, removed, renamed, newDependencies, commands, summary, patchFailures };
}

/**
 * Apply one str_replace patch. Refuses ambiguous edits (zero or multiple
 * matches) so the agent can never accidentally rewrite the wrong line.
 * Same semantics as Anthropic's text_editor_20250728 str_replace command.
 */
export function applyPatch(
  current: string | undefined,
  find: string,
  replace: string,
): { ok: true; contents: string } | { ok: false; reason: PatchFailure['reason'] } {
  if (current === undefined) return { ok: false, reason: 'file_not_found' };
  if (find.length === 0) return { ok: false, reason: 'find_empty' };
  // Normalise leading/trailing newlines on find — model often pads with one.
  const trimmedFind = find.replace(/^\n/, '').replace(/\n$/, '');
  const idx = current.indexOf(trimmedFind);
  if (idx === -1) return { ok: false, reason: 'find_no_match' };
  const lastIdx = current.lastIndexOf(trimmedFind);
  if (lastIdx !== idx) return { ok: false, reason: 'find_multi_match' };
  const trimmedReplace = replace.replace(/^\n/, '').replace(/\n$/, '');
  return {
    ok: true,
    contents: current.slice(0, idx) + trimmedReplace + current.slice(idx + trimmedFind.length),
  };
}

export function fingerprintFiles(files: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [path, contents] of files) out.set(path, sha256OfString(contents));
  return out;
}
