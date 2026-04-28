/**
 * Runtime error intelligence — deterministic error classification.
 *
 * When an operation errors in production, this module parses the stack trace
 * and error message, cross-references with the bundle source, and produces
 * a structured classification that tells the repair worker:
 *   1. WHAT broke (pattern name)
 *   2. WHERE it broke (file + line)
 *   3. WHY it broke (root cause analysis)
 *   4. HOW to fix it (suggested fix)
 *   5. WHETHER it's auto-fixable (confidence score)
 *
 * No LLM calls — purely deterministic pattern matching. Fast and reliable.
 */

export interface ErrorClassification {
  pattern: string;
  confidence: number;
  rootCause: string;
  affectedFiles: string[];
  suggestedFix: string;
  autoFixable: boolean;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category:
    | 'logic_error'
    | 'runtime_crash'
    | 'dependency_issue'
    | 'config_error'
    | 'resource_exhaustion'
    | 'external_service';
  /** Extracted file:line from the stack trace, if available. */
  stackLocation: { file: string; line: number } | null;
}

export interface ClassifyErrorArgs {
  operationId: string;
  stackTrace: string;
  errorMessage: string;
  recentEvents: Array<{ kind: string; message: string; occurredAt: string }>;
  bundleFiles: Array<{ path: string; contents: string }>;
}

/**
 * Classify a runtime error from a deployed operation.
 * Returns a structured classification for the repair worker.
 */
export function classifyError(args: ClassifyErrorArgs): ErrorClassification {
  const msg = args.errorMessage;
  const stack = args.stackTrace;
  const combined = `${msg}\n${stack}`;

  // Extract file:line from stack trace.
  const stackLocation = extractStackLocation(stack, args.bundleFiles);

  // Try each pattern matcher in priority order.
  for (const matcher of MATCHERS) {
    const result = matcher(combined, msg, stack, args, stackLocation);
    if (result) return result;
  }

  // Fallback: unknown error.
  return {
    pattern: 'unknown_error',
    confidence: 0.3,
    rootCause: `Unclassified error: ${msg.slice(0, 200)}`,
    affectedFiles: stackLocation ? [stackLocation.file] : [],
    suggestedFix: 'Review the stack trace manually and add error handling around the failing code path.',
    autoFixable: false,
    severity: 'medium',
    category: 'runtime_crash',
    stackLocation,
  };
}

type Matcher = (
  combined: string,
  msg: string,
  stack: string,
  args: ClassifyErrorArgs,
  loc: { file: string; line: number } | null,
) => ErrorClassification | null;

const MATCHERS: Matcher[] = [
  // ── Null/undefined reference ─────────────────────────────────────
  (combined, msg, _stack, args, loc) => {
    const m = msg.match(/TypeError: Cannot read propert(?:y|ies) of (?:undefined|null)(?: \(reading '(\w+)'\))?/i);
    if (!m) return null;
    const prop = m[1] ?? 'unknown';
    const affected = loc ? [loc.file] : findFilesContaining(args.bundleFiles, `.${prop}`);
    return {
      pattern: 'unhandled_null',
      confidence: 0.85,
      rootCause: `Attempted to access property '${prop}' on null/undefined. The variable was not initialized or a function returned null unexpectedly.`,
      affectedFiles: affected,
      suggestedFix: `Add a null check before accessing '.${prop}'. Use optional chaining (?.) or an explicit guard: if (!variable) return reply.code(400).send({ error: 'missing_data' });`,
      autoFixable: true,
      severity: 'high',
      category: 'logic_error',
      stackLocation: loc,
    };
  },

  // ── Missing module/import ────────────────────────────────────────
  (combined, msg, _stack, args, loc) => {
    const m = msg.match(/Error: Cannot find module '([^']+)'/i);
    if (!m) return null;
    const mod = m[1]!;
    const isRelative = mod.startsWith('.');
    const affected = isRelative && loc ? [loc.file] : [];
    return {
      pattern: 'missing_import',
      confidence: 0.95,
      rootCause: isRelative
        ? `File '${mod}' is imported but doesn't exist in the bundle. The import path is wrong or the file was never generated.`
        : `Package '${mod}' is imported but not in package.json, or was not installed.`,
      affectedFiles: affected,
      suggestedFix: isRelative
        ? `Either create the missing file '${mod}' or fix the import path in ${loc?.file ?? 'the importing file'}.`
        : `Add '${mod}' to package.json dependencies and run pnpm install.`,
      autoFixable: true,
      severity: 'critical',
      category: isRelative ? 'logic_error' : 'dependency_issue',
      stackLocation: loc,
    };
  },

  // ── Database connection errors ───────────────────────────────────
  (combined, msg, _stack, _args, loc) => {
    if (!/MongoNetworkError|MongoServerError|ECONNREFUSED.*27017|MongoTimeoutError|topology was destroyed/i.test(combined)) return null;
    return {
      pattern: 'db_connection',
      confidence: 0.9,
      rootCause: 'MongoDB connection failed. Either the connection string is wrong, the database server is unreachable, or the IP is not whitelisted.',
      affectedFiles: ['lib/mongo.js', 'server.js'],
      suggestedFix: 'Verify MONGODB_URI in environment variables. Ensure the database server is running and the IP is whitelisted. Add connection retry logic with exponential backoff.',
      autoFixable: false,
      severity: 'critical',
      category: 'config_error',
      stackLocation: loc,
    };
  },

  // ── Syntax errors ────────────────────────────────────────────────
  (combined, msg, _stack, _args, loc) => {
    const m = msg.match(/SyntaxError: (.+?)(?:\n|$)/i);
    if (!m) return null;
    return {
      pattern: 'syntax_error',
      confidence: 0.95,
      rootCause: `Syntax error in generated code: ${m[1]!.slice(0, 200)}`,
      affectedFiles: loc ? [loc.file] : [],
      suggestedFix: `Fix the syntax error at ${loc ? `${loc.file}:${loc.line}` : 'the location shown in the stack trace'}. Common causes: unclosed brackets, missing commas, invalid template literals.`,
      autoFixable: true,
      severity: 'critical',
      category: 'runtime_crash',
      stackLocation: loc,
    };
  },

  // ── Memory exhaustion ────────────────────────────────────────────
  (combined, _msg, _stack, _args, loc) => {
    if (!/FATAL ERROR|heap out of memory|CALL_AND_RETRY_LAST|JavaScript heap/i.test(combined)) return null;
    return {
      pattern: 'memory_exceeded',
      confidence: 0.85,
      rootCause: 'Process ran out of heap memory. Likely caused by an unbounded data structure, memory leak, or processing a dataset larger than available memory.',
      affectedFiles: loc ? [loc.file] : [],
      suggestedFix: 'Add pagination to database queries (limit/skip), use streaming for large data, or increase the sandbox memory allocation. Check for event listener leaks.',
      autoFixable: false,
      severity: 'critical',
      category: 'resource_exhaustion',
      stackLocation: loc,
    };
  },

  // ── Timeout errors ───────────────────────────────────────────────
  (combined, _msg, _stack, _args, loc) => {
    if (!/TimeoutError|ETIMEDOUT|ESOCKETTIMEDOUT|operation timed out|UND_ERR_HEADERS_TIMEOUT/i.test(combined)) return null;
    return {
      pattern: 'timeout',
      confidence: 0.8,
      rootCause: 'An HTTP request or database operation timed out. The downstream service is slow or unresponsive.',
      affectedFiles: loc ? [loc.file] : [],
      suggestedFix: 'Add retry logic with exponential backoff (250ms, 750ms, 2000ms). Set explicit timeouts on all external HTTP calls. Consider circuit breaker pattern for unreliable services.',
      autoFixable: true,
      severity: 'medium',
      category: 'external_service',
      stackLocation: loc,
    };
  },

  // ── Authentication failures ──────────────────────────────────────
  (combined, _msg, _stack, _args, loc) => {
    if (!/401|403|Unauthorized|Forbidden|invalid.*(?:api[_\s]?key|token|credential)/i.test(combined)) return null;
    return {
      pattern: 'auth_failed',
      confidence: 0.75,
      rootCause: 'Authentication or authorization failed when calling an external service. The API key may be expired, revoked, or misconfigured.',
      affectedFiles: loc ? [loc.file] : [],
      suggestedFix: 'Verify all API keys and tokens in environment variables. Check if they have the required permissions/scopes. Ensure keys are not expired.',
      autoFixable: false,
      severity: 'high',
      category: 'config_error',
      stackLocation: loc,
    };
  },

  // ── Rate limiting ────────────────────────────────────────────────
  (combined, _msg, _stack, _args, loc) => {
    if (!/429|rate.?limit|too many requests|quota.*exceeded/i.test(combined)) return null;
    return {
      pattern: 'rate_limited',
      confidence: 0.85,
      rootCause: 'External API rate limit exceeded. The operation is making too many requests in a short time period.',
      affectedFiles: loc ? [loc.file] : [],
      suggestedFix: 'Add exponential backoff retry logic. Implement request batching. Cache responses where possible. Consider using a queue (BullMQ) to throttle requests.',
      autoFixable: true,
      severity: 'medium',
      category: 'external_service',
      stackLocation: loc,
    };
  },

  // ── Unhandled promise rejection ──────────────────────────────────
  (combined, _msg, _stack, _args, loc) => {
    if (!/UnhandledPromiseRejection|unhandled.*rejection/i.test(combined)) return null;
    return {
      pattern: 'unhandled_rejection',
      confidence: 0.7,
      rootCause: 'An async operation failed without a .catch() or try/catch handler. The error propagated to the process level.',
      affectedFiles: loc ? [loc.file] : [],
      suggestedFix: 'Wrap the failing async call in a try/catch block. Add .catch() to all Promise chains. Ensure all route handlers use async/await with proper error handling.',
      autoFixable: true,
      severity: 'high',
      category: 'logic_error',
      stackLocation: loc,
    };
  },

  // ── Port already in use ──────────────────────────────────────────
  (combined, _msg, _stack, _args, loc) => {
    if (!/EADDRINUSE|address already in use/i.test(combined)) return null;
    return {
      pattern: 'port_in_use',
      confidence: 0.95,
      rootCause: 'The server port is already occupied by another process. This usually means a previous instance didn\'t shut down cleanly.',
      affectedFiles: ['server.js'],
      suggestedFix: 'The sandbox process manager should handle this. If persists, add a SIGTERM handler that calls server.close() before exit.',
      autoFixable: false,
      severity: 'medium',
      category: 'config_error',
      stackLocation: loc,
    };
  },

  // ── JSON parse errors ────────────────────────────────────────────
  (combined, msg, _stack, _args, loc) => {
    if (!/SyntaxError:.*(?:Unexpected token|JSON)/i.test(msg)) return null;
    return {
      pattern: 'json_parse_error',
      confidence: 0.8,
      rootCause: 'Attempted to parse invalid JSON. The input from a request body or API response is not valid JSON.',
      affectedFiles: loc ? [loc.file] : [],
      suggestedFix: 'Wrap JSON.parse() in a try/catch. Validate content-type before parsing. Return 400 with a clear error message for malformed input.',
      autoFixable: true,
      severity: 'medium',
      category: 'logic_error',
      stackLocation: loc,
    };
  },

  // ── Zod validation errors surfacing as 500 ───────────────────────
  (combined, _msg, _stack, _args, loc) => {
    if (!/ZodError|z\.ZodError/i.test(combined)) return null;
    return {
      pattern: 'uncaught_validation',
      confidence: 0.85,
      rootCause: 'A Zod validation error was thrown but not caught. The route used .parse() instead of .safeParse(), causing an unhandled exception instead of a 400 response.',
      affectedFiles: loc ? [loc.file] : [],
      suggestedFix: 'Replace schema.parse(body) with schema.safeParse(body) and check the .success property. Return 400 with .error.issues on failure.',
      autoFixable: true,
      severity: 'high',
      category: 'logic_error',
      stackLocation: loc,
    };
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Extract the first relevant file:line from a stack trace.
 * Filters out node_modules and internal Node.js frames.
 */
function extractStackLocation(
  stack: string,
  bundleFiles: Array<{ path: string }>,
): { file: string; line: number } | null {
  const bundlePaths = new Set(bundleFiles.map((f) => f.path));
  const lines = stack.split('\n');

  for (const line of lines) {
    // Match patterns like "at /workspace/routes/form.js:42:15"
    // or "at Object.<anonymous> (routes/form.js:42:15)"
    const m = line.match(/(?:at\s+.*?)?\(?(?:\/workspace\/)?([^:()]+):(\d+)(?::\d+)?\)?/);
    if (!m) continue;
    const filePath = m[1]!.trim();
    const lineNum = parseInt(m[2]!, 10);

    // Skip node_modules and Node internals.
    if (filePath.includes('node_modules')) continue;
    if (filePath.startsWith('node:')) continue;
    if (filePath.startsWith('internal/')) continue;

    // Prefer files that are in the bundle.
    if (bundlePaths.has(filePath)) {
      return { file: filePath, line: lineNum };
    }
  }

  // Second pass: take any non-node_modules file.
  for (const line of lines) {
    const m = line.match(/(?:at\s+.*?)?\(?(?:\/workspace\/)?([^:()]+):(\d+)(?::\d+)?\)?/);
    if (!m) continue;
    const filePath = m[1]!.trim();
    if (filePath.includes('node_modules') || filePath.startsWith('node:')) continue;
    return { file: filePath, line: parseInt(m[2]!, 10) };
  }

  return null;
}

/**
 * Find bundle files that contain a given string.
 */
function findFilesContaining(
  files: Array<{ path: string; contents: string }>,
  search: string,
): string[] {
  return files
    .filter((f) => f.contents.includes(search))
    .map((f) => f.path)
    .slice(0, 5);
}

/**
 * Render an error classification as context for the repair prompt.
 * This gives the LLM a head start on understanding the problem.
 */
export function renderClassificationAsRepairContext(c: ErrorClassification): string {
  const lines: string[] = [];
  lines.push('# Error Intelligence Report');
  lines.push('');
  lines.push(`Pattern: ${c.pattern}`);
  lines.push(`Severity: ${c.severity}`);
  lines.push(`Category: ${c.category}`);
  lines.push(`Confidence: ${Math.round(c.confidence * 100)}%`);
  lines.push(`Auto-fixable: ${c.autoFixable ? 'yes' : 'no — may need manual intervention'}`);
  lines.push('');
  lines.push(`## Root cause`);
  lines.push(c.rootCause);
  lines.push('');
  if (c.stackLocation) {
    lines.push(`## Location`);
    lines.push(`${c.stackLocation.file}:${c.stackLocation.line}`);
    lines.push('');
  }
  if (c.affectedFiles.length > 0) {
    lines.push(`## Affected files`);
    for (const f of c.affectedFiles) lines.push(`- ${f}`);
    lines.push('');
  }
  lines.push(`## Suggested fix`);
  lines.push(c.suggestedFix);
  lines.push('');
  lines.push('Apply this fix surgically. Use <dyad-patch> for small changes. Do NOT rewrite unaffected files.');
  return lines.join('\n');
}
