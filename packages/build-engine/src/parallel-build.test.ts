import { describe, it, expect } from 'vitest';
import { mergeTaskOutputs, verifyMergedBundle, type TaskCategory } from './parallel-build.js';

describe('parallel-build', () => {
  describe('mergeTaskOutputs', () => {
    it('merges non-conflicting outputs correctly', () => {
      const outputs = [
        {
          taskId: 'backend',
          category: 'backend' as TaskCategory,
          files: new Map([
            ['server.js', 'const app = require("fastify")();'],
            ['routes/api.js', 'module.exports = function(app) {};'],
          ]),
        },
        {
          taskId: 'frontend',
          category: 'frontend' as TaskCategory,
          files: new Map([
            ['web/App.tsx', 'export function App() { return <div />; }'],
            ['web/main.tsx', 'createRoot(document.getElementById("root")!).render(<App />);'],
          ]),
        },
      ];

      const result = mergeTaskOutputs(outputs);
      expect(result.files.size).toBe(4);
      expect(result.conflicts.length).toBe(0);
      expect(result.summary.fromBackend).toBe(2);
      expect(result.summary.fromFrontend).toBe(2);
    });

    it('detects conflicts when two tasks produce the same file', () => {
      const outputs = [
        {
          taskId: 'backend',
          category: 'backend' as TaskCategory,
          files: new Map([
            ['package.json', '{"name":"app","dependencies":{"fastify":"^4"}}'],
          ]),
        },
        {
          taskId: 'config',
          category: 'config' as TaskCategory,
          files: new Map([
            ['package.json', '{"name":"app","dependencies":{"fastify":"^4","react":"^18"}}'],
          ]),
        },
      ];

      const result = mergeTaskOutputs(outputs);
      expect(result.conflicts.length).toBe(1);
      expect(result.conflicts[0]!.path).toBe('package.json');
      expect(result.conflicts[0]!.sources.length).toBe(2);
      expect(result.summary.conflictCount).toBe(1);
    });

    it('takes the longest version on conflict', () => {
      const short = 'short';
      const long = 'much longer content that should win the merge';

      const outputs = [
        {
          taskId: 'a',
          category: 'backend' as TaskCategory,
          files: new Map([['shared.js', short]]),
        },
        {
          taskId: 'b',
          category: 'frontend' as TaskCategory,
          files: new Map([['shared.js', long]]),
        },
      ];

      const result = mergeTaskOutputs(outputs);
      expect(result.files.get('shared.js')).toBe(long);
    });

    it('counts files per category correctly', () => {
      const outputs = [
        { taskId: 'db', category: 'database' as TaskCategory, files: new Map([['db/mongo.js', 'x'], ['db/schema.js', 'y']]) },
        { taskId: 'auth', category: 'auth' as TaskCategory, files: new Map([['auth/login.js', 'z']]) },
        { taskId: 'test', category: 'testing' as TaskCategory, files: new Map([['tests/health.test.js', 'w']]) },
      ];

      const result = mergeTaskOutputs(outputs);
      expect(result.summary.fromDatabase).toBe(2);
      expect(result.summary.fromAuth).toBe(1);
      expect(result.summary.fromTesting).toBe(1);
      expect(result.summary.totalFiles).toBe(4);
    });
  });

  describe('verifyMergedBundle', () => {
    it('passes when all expected files exist', () => {
      const expected = ['server.js', 'package.json'];
      const actual = new Map([
        ['server.js', 'const app = require("fastify")();'],
        ['package.json', '{"name":"test","type":"module","scripts":{"start":"node server.js"}}'],
      ]);

      const result = verifyMergedBundle(expected, actual);
      expect(result.missingFiles.length).toBe(0);
    });

    it('fails when expected files are missing', () => {
      const expected = ['server.js', 'package.json', 'README.md'];
      const actual = new Map([
        ['server.js', 'const app = require("fastify")();'],
      ]);

      const result = verifyMergedBundle(expected, actual);
      expect(result.missingFiles).toContain('package.json');
      expect(result.missingFiles).toContain('README.md');
      expect(result.passed).toBe(false);
    });

    it('detects console.log in production code', () => {
      const actual = new Map([
        ['server.js', 'console.log("hello");'],
      ]);

      const result = verifyMergedBundle([], actual);
      expect(result.suggestions.some((s) => s.includes('console.log'))).toBe(true);
    });

    it('detects hardcoded secrets', () => {
      const actual = new Map([
        ['config.js', 'const key = "sk-abcdefghijklmnopqrstuvwxyz";'],
      ]);

      const result = verifyMergedBundle([], actual);
      expect(result.securityIssues.some((s) => s.includes('API key'))).toBe(true);
    });

    it('detects invalid package.json', () => {
      const actual = new Map([
        ['package.json', 'not valid json'],
      ]);

      const result = verifyMergedBundle([], actual);
      expect(result.securityIssues.some((s) => s.includes('invalid JSON'))).toBe(true);
    });

    it('detects missing start script in package.json', () => {
      const actual = new Map([
        ['package.json', '{"name":"test","type":"module"}'],
      ]);

      const result = verifyMergedBundle([], actual);
      expect(result.suggestions.some((s) => s.includes('start script'))).toBe(true);
    });

    it('detects TODO comments', () => {
      const actual = new Map([
        ['routes/api.js', '// TODO: implement this\nfunction handler() {}'],
      ]);

      const result = verifyMergedBundle([], actual);
      expect(result.suggestions.some((s) => s.includes('TODO'))).toBe(true);
    });
  });
});
