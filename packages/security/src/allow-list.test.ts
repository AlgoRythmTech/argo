import { describe, expect, it } from 'vitest';
import { isAllowListed, validateImports } from './allow-list.js';

describe('isAllowListed', () => {
  it('accepts node builtins', () => {
    expect(isAllowListed('node:crypto')).toBe(true);
  });

  it('accepts core packages', () => {
    expect(isAllowListed('fastify')).toBe(true);
    expect(isAllowListed('zod')).toBe(true);
    expect(isAllowListed('@argo/shared-types')).toBe(true);
  });

  it('rejects unknown packages', () => {
    expect(isAllowListed('totally-fake-pkg-xyz')).toBe(false);
    expect(isAllowListed('@evil/payload')).toBe(false);
  });

  it('looks at the root package, not subpaths', () => {
    expect(isAllowListed('fastify/plugin/x')).toBe(true);
    expect(isAllowListed('@argo/shared-types/workflow')).toBe(true);
  });
});

describe('validateImports', () => {
  it('flags hallucinated package names', () => {
    const issues = validateImports(['fastify', 'left-pad-deluxe-2026', 'zod']);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.importPath).toBe('left-pad-deluxe-2026');
    expect(issues[0]?.reason).toBe('not_allow_listed');
  });

  it('allows relative imports by default', () => {
    expect(validateImports(['./local-helper.js'])).toHaveLength(0);
  });
});
