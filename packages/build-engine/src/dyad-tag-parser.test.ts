import { describe, expect, it } from 'vitest';
import { applyActionsToFileMap, parseDyadResponse } from './dyad-tag-parser.js';

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
