import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from './frontmatter.js';

describe('parseFrontmatter', () => {
  it('returns empty when no frontmatter is present', () => {
    const r = parseFrontmatter('# hello\n\nbody');
    expect(r.scalars).toEqual({});
    expect(r.structured).toEqual({});
    expect(r.body).toBe('# hello\n\nbody');
  });

  it('reads name and description from a simple SKILL.md', () => {
    const md = `---\nname: weather\ndescription: Look up the weather for a city.\n---\n# Weather skill\n\nbody here.\n`;
    const r = parseFrontmatter(md);
    expect(r.scalars.name).toBe('weather');
    expect(r.scalars.description).toBe('Look up the weather for a city.');
    expect(r.body).toContain('# Weather skill');
  });

  it('preserves nested objects in structured output', () => {
    const md = `---
name: composer
description: Compose stuff.
metadata:
  argo:
    emoji: "🦞"
    inputSchema:
      type: object
      properties:
        topic:
          type: string
---
body`;
    const r = parseFrontmatter(md);
    expect(r.scalars.name).toBe('composer');
    const meta = r.structured.metadata as { argo?: { emoji?: string; inputSchema?: unknown } };
    expect(meta?.argo?.emoji).toBe('🦞');
    expect(meta?.argo?.inputSchema).toMatchObject({ type: 'object' });
  });

  it('prefers the line-form scalar when YAML mis-parses a colon-containing description', () => {
    // YAML would parse `description: foo: bar` as a nested map; line-form
    // keeps it as a string.
    const md = `---\nname: x\ndescription: foo: bar\n---\nbody`;
    const r = parseFrontmatter(md);
    expect(r.scalars.description).toBe('foo: bar');
  });

  it('handles multi-line scalar values (description block)', () => {
    const md = `---
name: x
description: |
  One sentence.
  Two sentence.
---
body`;
    const r = parseFrontmatter(md);
    expect(r.scalars.description).toMatch(/One sentence\.\s*Two sentence\./);
  });

  it('strips quotes from inline scalars', () => {
    const md = `---\nname: "quoted-name"\ndescription: 'with apostrophes'\n---\n`;
    const r = parseFrontmatter(md);
    expect(r.scalars.name).toBe('quoted-name');
    expect(r.scalars.description).toBe('with apostrophes');
  });

  it('returns empty structured when frontmatter delimiter is missing', () => {
    const md = `---\nname: x\nbut never closes`;
    const r = parseFrontmatter(md);
    expect(r.scalars).toEqual({});
    expect(r.body).toBe(md);
  });

  it('normalizes CRLF line endings before parsing', () => {
    const md = `---\r\nname: crlf\r\ndescription: works on windows\r\n---\r\nbody`;
    const r = parseFrontmatter(md);
    expect(r.scalars.name).toBe('crlf');
    expect(r.scalars.description).toBe('works on windows');
  });
});
