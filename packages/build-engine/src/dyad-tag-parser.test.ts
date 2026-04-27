import { describe, expect, it } from 'vitest';
import { applyActionsToFileMap, applyPatch, parseDyadResponse } from './dyad-tag-parser.js';

describe('parseDyadResponse', () => {
  it('parses a single dyad-write block', () => {
    const r = parseDyadResponse(
      `Sure, here's the file.\n<dyad-write path="src/foo.ts" description="adds foo">export const foo = 1;\n</dyad-write>\n<dyad-chat-summary>Adding foo</dyad-chat-summary>`,
    );
    expect(r.actions).toHaveLength(2);
    expect(r.actions[0]).toMatchObject({
      kind: 'write',
      path: 'src/foo.ts',
      description: 'adds foo',
    });
    expect((r.actions[0] as { contents: string }).contents).toContain('export const foo = 1');
    expect(r.actions[1]).toMatchObject({ kind: 'chat-summary', summary: 'Adding foo' });
  });

  it('detects an unclosed dyad-write tail', () => {
    const r = parseDyadResponse(`<dyad-write path="src/foo.ts">export const a = 1;`);
    expect(r.hasUnclosedWrite).toBe(true);
    expect(r.actions).toHaveLength(0);
  });

  it('parses rename, delete and add-dependency in one response', () => {
    const r = parseDyadResponse(
      `<dyad-rename from="src/A.tsx" to="src/B.tsx"></dyad-rename>` +
        `<dyad-delete path="src/Old.tsx"></dyad-delete>` +
        `<dyad-add-dependency packages="react-hot-toast nanoid"></dyad-add-dependency>`,
    );
    const kinds = r.actions.map((a) => a.kind).sort();
    expect(kinds).toEqual(['add-dependency', 'delete', 'rename']);
  });

  it('strips tag content from prose', () => {
    const r = parseDyadResponse(
      `Hi.\n<dyad-write path="x">y</dyad-write>\nDone.`,
    );
    expect(r.prose).toContain('Hi.');
    expect(r.prose).toContain('Done.');
    expect(r.prose).not.toContain('<dyad-write');
  });
});

describe('applyActionsToFileMap', () => {
  it('adds, modifies, deletes and renames as expected', () => {
    const initial = new Map<string, string>([
      ['a.ts', 'old'],
      ['b.ts', 'b'],
      ['c.ts', 'c'],
    ]);
    const result = applyActionsToFileMap(initial, [
      { kind: 'write', path: 'a.ts', description: null, contents: 'new' },
      { kind: 'write', path: 'd.ts', description: null, contents: 'd' },
      { kind: 'rename', from: 'b.ts', to: 'b2.ts' },
      { kind: 'delete', path: 'c.ts' },
      { kind: 'add-dependency', packages: ['nanoid'] },
      { kind: 'command', command: 'rebuild' },
      { kind: 'chat-summary', summary: 'Refactor' },
    ]);
    expect(result.added).toEqual(['d.ts']);
    expect(result.modified).toEqual(['a.ts']);
    expect(result.removed).toEqual(['c.ts']);
    expect(result.renamed).toEqual([{ from: 'b.ts', to: 'b2.ts' }]);
    expect(result.newDependencies).toEqual(['nanoid']);
    expect(result.commands).toEqual(['rebuild']);
    expect(result.summary).toBe('Refactor');
    expect(result.files.get('a.ts')).toBe('new');
    expect(result.files.get('b2.ts')).toBe('b');
    expect(result.files.has('c.ts')).toBe(false);
  });
});

// ── Surgical patches ──────────────────────────────────────────────────

describe('parseDyadResponse — patch blocks', () => {
  it('parses a dyad-patch block with find + replace', () => {
    const r = parseDyadResponse(
      '<dyad-patch path="server.js"><find>old text</find><replace>new text</replace></dyad-patch>' +
        '<dyad-chat-summary>Patched</dyad-chat-summary>',
    );
    const patch = r.actions.find((a) => a.kind === 'patch');
    expect(patch).toMatchObject({
      kind: 'patch',
      path: 'server.js',
      find: 'old text',
      replace: 'new text',
    });
  });

  it('skips a dyad-patch missing find or replace', () => {
    const r = parseDyadResponse(
      '<dyad-patch path="server.js"><find>old</find></dyad-patch>',
    );
    expect(r.actions.filter((a) => a.kind === 'patch')).toHaveLength(0);
  });

  it('strips dyad-patch from prose', () => {
    const r = parseDyadResponse(
      'Tweaking the port.\n<dyad-patch path="server.js"><find>old</find><replace>new</replace></dyad-patch>\nDone.',
    );
    expect(r.prose).toContain('Tweaking the port');
    expect(r.prose).toContain('Done');
    expect(r.prose).not.toContain('<dyad-patch');
  });
});

describe('applyPatch', () => {
  it('replaces an exact unique match', () => {
    const r = applyPatch('hello world\nfoo bar', 'foo bar', 'baz qux');
    expect(r).toEqual({ ok: true, contents: 'hello world\nbaz qux' });
  });

  it('refuses when the find string is empty', () => {
    expect(applyPatch('hello', '', 'x')).toEqual({ ok: false, reason: 'find_empty' });
  });

  it('refuses when find does not appear', () => {
    expect(applyPatch('hello world', 'goodbye', 'farewell')).toEqual({
      ok: false,
      reason: 'find_no_match',
    });
  });

  it('refuses when find matches multiple times (ambiguous)', () => {
    expect(applyPatch('repeat\nrepeat\nrepeat', 'repeat', 'once')).toEqual({
      ok: false,
      reason: 'find_multi_match',
    });
  });

  it('refuses when the file is not in the bundle', () => {
    expect(applyPatch(undefined, 'anything', 'x')).toEqual({
      ok: false,
      reason: 'file_not_found',
    });
  });

  it('strips a leading + trailing newline from the find pattern', () => {
    const r = applyPatch('start\nmid\nend', '\nmid\n', '\nmiddle\n');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.contents).toBe('start\nmiddle\nend');
  });
});

describe('applyActionsToFileMap with patches', () => {
  it('applies a successful patch, marks the file as modified', () => {
    const initial = new Map([['server.js', 'const port = 3000;']]);
    const r = applyActionsToFileMap(initial, [
      {
        kind: 'patch',
        path: 'server.js',
        find: 'const port = 3000;',
        replace: 'const port = Number(process.env.PORT) || 3000;',
      },
    ]);
    expect(r.files.get('server.js')).toBe('const port = Number(process.env.PORT) || 3000;');
    expect(r.modified).toContain('server.js');
    expect(r.patchFailures).toHaveLength(0);
  });

  it('records a patch failure when the find text is missing', () => {
    const r = applyActionsToFileMap(new Map([['server.js', 'a']]), [
      { kind: 'patch', path: 'server.js', find: 'b', replace: 'c' },
    ]);
    expect(r.patchFailures).toHaveLength(1);
    expect(r.patchFailures[0]?.reason).toBe('find_no_match');
    expect(r.files.get('server.js')).toBe('a');
  });

  it('mixes write + patch in one cycle', () => {
    const initial = new Map([['server.js', 'console.log(1);']]);
    const r = applyActionsToFileMap(initial, [
      { kind: 'patch', path: 'server.js', find: 'console.log(1);', replace: 'console.log(2);' },
      {
        kind: 'write',
        path: 'routes/health.js',
        description: 'health route',
        contents: 'export const h = 1;',
      },
    ]);
    expect(r.files.get('server.js')).toBe('console.log(2);');
    expect(r.files.get('routes/health.js')).toBe('export const h = 1;');
    expect(r.added).toContain('routes/health.js');
    expect(r.modified).toContain('server.js');
  });
});
