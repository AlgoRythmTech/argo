import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import { repairSyntaxErrors } from './syntax-repair.js';

let originalDispatcher: Dispatcher;
let mockAgent: MockAgent;

beforeEach(() => {
  originalDispatcher = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
});

afterEach(async () => {
  setGlobalDispatcher(originalDispatcher);
  await mockAgent.close();
});

function mockOpenAiResponse(response: unknown): void {
  const pool = mockAgent.get('https://api.openai.com');
  pool
    .intercept({ path: '/v1/chat/completions', method: 'POST' })
    .reply(200, {
      choices: [{ message: { content: JSON.stringify(response) } }],
    });
}

describe('repairSyntaxErrors', () => {
  it('returns empty result when no breaks are provided', async () => {
    const r = await repairSyntaxErrors({ breaks: [], apiKey: 'sk-test' });
    expect(r.fixed).toEqual({});
    expect(r.outcomes).toEqual([]);
  });

  it('returns declined outcomes when no API key is set', async () => {
    const r = await repairSyntaxErrors({
      breaks: [
        {
          path: 'broken.js',
          contents: 'const x = { a: 1,, b: 2 };',
          parserError: 'Unexpected token',
          parserErrorLine: 1,
        },
      ],
      apiKey: '',
    });
    expect(r.fixed).toEqual({});
    expect(r.outcomes).toHaveLength(1);
    expect(r.outcomes[0]?.outcome).toBe('declined');
    expect(r.outcomes[0]?.note).toBe('no_api_key');
  });

  it('applies model-returned replacements to fixed map', async () => {
    mockOpenAiResponse({
      files: [
        {
          path: 'broken.js',
          replacement: 'const x = { a: 1, b: 2 };',
          reason: 'removed stray comma after a:1',
        },
      ],
    });
    const r = await repairSyntaxErrors({
      breaks: [
        {
          path: 'broken.js',
          contents: 'const x = { a: 1,, b: 2 };',
          parserError: 'Unexpected token',
          parserErrorLine: 1,
        },
      ],
      apiKey: 'sk-test',
    });
    expect(r.fixed['broken.js']).toBe('const x = { a: 1, b: 2 };');
    expect(r.outcomes[0]?.outcome).toBe('fixed');
  });

  it('marks "unchanged" when the model returns the same contents', async () => {
    const original = 'const x = { a: 1, b: 2 };';
    mockOpenAiResponse({
      files: [
        { path: 'maybe.js', replacement: original, reason: 'looks fine to me' },
      ],
    });
    const r = await repairSyntaxErrors({
      breaks: [
        {
          path: 'maybe.js',
          contents: original,
          parserError: 'Unexpected token',
          parserErrorLine: null,
        },
      ],
      apiKey: 'sk-test',
    });
    expect(r.fixed).toEqual({});
    expect(r.outcomes[0]?.outcome).toBe('unchanged');
  });

  it('marks "declined" when the model returns an empty replacement', async () => {
    mockOpenAiResponse({
      files: [{ path: 'hard.js', replacement: '', reason: 'cannot infer intent' }],
    });
    const r = await repairSyntaxErrors({
      breaks: [
        {
          path: 'hard.js',
          contents: 'const x = }}}}',
          parserError: 'Unexpected token',
          parserErrorLine: 1,
        },
      ],
      apiKey: 'sk-test',
    });
    expect(r.fixed).toEqual({});
    expect(r.outcomes[0]?.outcome).toBe('declined');
  });

  it('marks "declined" with missing_from_response when model omits a file', async () => {
    mockOpenAiResponse({ files: [] });
    const r = await repairSyntaxErrors({
      breaks: [
        {
          path: 'orphan.js',
          contents: 'const x = ;',
          parserError: 'Unexpected token',
          parserErrorLine: 1,
        },
      ],
      apiKey: 'sk-test',
    });
    expect(r.outcomes[0]?.outcome).toBe('declined');
    expect(r.outcomes[0]?.note).toBe('missing_from_response');
  });

  it('handles multiple breaks in one pass', async () => {
    mockOpenAiResponse({
      files: [
        { path: 'a.js', replacement: 'const a = 1;', reason: 'closed string' },
        { path: 'b.js', replacement: 'const b = 2;', reason: 'closed brace' },
      ],
    });
    const r = await repairSyntaxErrors({
      breaks: [
        { path: 'a.js', contents: 'const a = "', parserError: 'Unterminated string', parserErrorLine: 1 },
        { path: 'b.js', contents: 'const b = {', parserError: 'Unexpected EOF', parserErrorLine: 1 },
      ],
      apiKey: 'sk-test',
    });
    expect(Object.keys(r.fixed)).toEqual(['a.js', 'b.js']);
    expect(r.outcomes.every((o) => o.outcome === 'fixed')).toBe(true);
  });

  it('ignores files in response that we did not ask about', async () => {
    mockOpenAiResponse({
      files: [
        { path: 'a.js', replacement: 'const a = 1;', reason: 'fixed' },
        { path: 'phantom.js', replacement: 'const x = 0;', reason: 'unsolicited' },
      ],
    });
    const r = await repairSyntaxErrors({
      breaks: [
        { path: 'a.js', contents: 'const a = ;', parserError: 'Unexpected token', parserErrorLine: 1 },
      ],
      apiKey: 'sk-test',
    });
    expect(Object.keys(r.fixed)).toEqual(['a.js']);
    expect(r.outcomes.find((o) => o.path === 'phantom.js')).toBeUndefined();
  });
});
