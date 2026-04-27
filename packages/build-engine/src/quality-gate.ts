// Quality gate — every generated bundle passes through this BEFORE the
// IExecutionProvider deploys it. Catches the "looks fine but won't run"
// class of LLM failure that kills Replit-style platforms.
//
// Five checks run in sequence; first failure short-circuits with a
// structured QualityReport the auto-fix loop reads to re-prompt the model.

import { validateImports, type ImportValidationIssue } from '@argo/security';
import type { OperationBundle, OperationBundleFile } from '@argo/workspace-runtime';
import { hasGeneratedHeader } from './header.js';
import { detectInlinedSecrets } from './validators/secret-validator.js';
import { extractImports } from './validators/import-validator.js';

export type QualityCheckId =
  | 'argo_generated_header_present'
  | 'no_inlined_secrets'
  | 'imports_allow_listed'
  | 'no_console_log'
  | 'no_eval_or_function_constructor'
  | 'no_typescript_any'
  | 'no_unhandled_promise_rejection'
  | 'no_hardcoded_localhost'
  | 'every_route_has_zod_validation'
  | 'health_route_present'
  | 'sigterm_handler_present'
  | 'binds_to_0_0_0_0'
  | 'no_synchronous_fs'
  | 'package_json_valid'
  | 'no_deprecated_apis'
  // ── v2 hardening (Day 4): ten more security & operational checks ──
  | 'no_sql_string_concatenation'
  | 'no_prototype_pollution'
  | 'no_weak_crypto'
  | 'no_unsafe_regex'
  | 'no_path_traversal_from_user_input'
  | 'no_xml_external_entities'
  | 'public_post_routes_have_rate_limit'
  | 'no_secrets_in_error_messages'
  | 'no_open_cors_in_prod'
  | 'no_http_in_outbound_urls'
  // ── v3 hardening (Day 4 part 2): operational + reliability checks ──
  | 'no_missing_await_on_async'
  | 'helmet_registered'
  | 'body_limit_set'
  | 'fastify_error_handler_set'
  | 'mongo_collection_has_indexes'
  | 'route_sets_content_type'
  | 'no_exposed_stack_traces'
  | 'request_logger_in_handlers';

export interface QualityIssue {
  check: QualityCheckId;
  severity: 'error' | 'warn';
  file: string;
  line: number | null;
  message: string;
}

export interface QualityReport {
  passed: boolean;
  errorCount: number;
  warnCount: number;
  issues: QualityIssue[];
  /** Human-readable summary the auto-fix loop feeds back to the model. */
  autoFixPrompt: string;
}

export function runQualityGate(bundle: OperationBundle): QualityReport {
  const issues: QualityIssue[] = [];

  for (const file of bundle.files) {
    issues.push(...checkHeaders(file));
    issues.push(...checkSecrets(file));
    issues.push(...checkImports(file));
    issues.push(...checkConsoleLog(file));
    issues.push(...checkEval(file));
    issues.push(...checkAny(file));
    issues.push(...checkUnhandled(file));
    issues.push(...checkLocalhost(file));
    issues.push(...checkSyncFs(file));
    // v2 hardening
    issues.push(...checkSqlConcatenation(file));
    issues.push(...checkPrototypePollution(file));
    issues.push(...checkWeakCrypto(file));
    issues.push(...checkUnsafeRegex(file));
    issues.push(...checkPathTraversal(file));
    issues.push(...checkXmlEntities(file));
    issues.push(...checkSecretsInErrors(file));
    issues.push(...checkOpenCors(file));
    issues.push(...checkHttpOutboundUrls(file));
    // v3 hardening
    issues.push(...checkMissingAwait(file));
    issues.push(...checkExposedStackTraces(file));
    issues.push(...checkRequestLogger(file));
    issues.push(...checkRouteSetsContentType(file));
  }

  issues.push(...checkServerBootstrap(bundle));
  issues.push(...checkPackageJson(bundle));
  issues.push(...checkRouteValidation(bundle));
  issues.push(...checkPublicRoutesHaveRateLimit(bundle));
  issues.push(...checkHelmetRegistered(bundle));
  issues.push(...checkBodyLimitSet(bundle));
  issues.push(...checkFastifyErrorHandler(bundle));
  issues.push(...checkMongoIndexes(bundle));

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warnCount = issues.filter((i) => i.severity === 'warn').length;

  return {
    passed: errorCount === 0,
    errorCount,
    warnCount,
    issues,
    autoFixPrompt: composeAutoFixPrompt(issues),
  };
}

// ── Per-file checks ────────────────────────────────────────────────────

function checkHeaders(f: OperationBundleFile): QualityIssue[] {
  if (!f.argoGenerated) return [];
  if (!/\.(ts|tsx|js|mjs|cjs)$/i.test(f.path)) return [];
  if (hasGeneratedHeader(f.contents)) return [];
  return [
    {
      check: 'argo_generated_header_present',
      severity: 'error',
      file: f.path,
      line: 1,
      message: 'Generated file is missing the argo:generated header. Add it as the first comment block.',
    },
  ];
}

function checkSecrets(f: OperationBundleFile): QualityIssue[] {
  const matches = detectInlinedSecrets(f.contents);
  return matches.map((m) => ({
    check: 'no_inlined_secrets',
    severity: 'error',
    file: f.path,
    line: null,
    message: `Inlined ${m.kind} detected (${m.preview}). Move to environment variables and read with process.env.`,
  }));
}

function checkImports(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|tsx|js|mjs|cjs)$/i.test(f.path)) return [];
  const found = extractImports(f.contents);
  const issues: ImportValidationIssue[] = validateImports(found, { allowRelative: true });
  return issues.map((i) => ({
    check: 'imports_allow_listed',
    severity: 'error',
    file: f.path,
    line: null,
    message: `Import "${i.importPath}" is ${i.reason.replace(/_/g, ' ')}. Use only allow-listed packages.`,
  }));
}

function checkConsoleLog(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|tsx|js|mjs|cjs)$/i.test(f.path)) return [];
  const out: QualityIssue[] = [];
  const lines = f.contents.split('\n');
  lines.forEach((line, idx) => {
    if (/\bconsole\.(log|info|debug|warn|error)\s*\(/.test(line)) {
      // The mock-server fallback in docker-mock is the one allowed exception.
      if (line.includes('// argo:scaffolding') || line.includes('// argo:mock')) return;
      out.push({
        check: 'no_console_log',
        severity: 'warn',
        file: f.path,
        line: idx + 1,
        message: 'Use the pino logger (req.log or app.log), not console.*. Operators replay logs via PII-redacted store.',
      });
    }
  });
  return out;
}

function checkEval(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|tsx|js|mjs|cjs)$/i.test(f.path)) return [];
  const out: QualityIssue[] = [];
  const lines = f.contents.split('\n');
  lines.forEach((line, idx) => {
    if (/\beval\s*\(/.test(line) || /\bnew\s+Function\s*\(/.test(line)) {
      out.push({
        check: 'no_eval_or_function_constructor',
        severity: 'error',
        file: f.path,
        line: idx + 1,
        message: 'eval() and new Function() are forbidden. Use a real parser or a structured config instead.',
      });
    }
  });
  return out;
}

function checkAny(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|tsx)$/i.test(f.path)) return [];
  const out: QualityIssue[] = [];
  const lines = f.contents.split('\n');
  lines.forEach((line, idx) => {
    if (/:\s*any\b/.test(line) && !line.trim().startsWith('//')) {
      out.push({
        check: 'no_typescript_any',
        severity: 'warn',
        file: f.path,
        line: idx + 1,
        message: 'Avoid `any`. Use `unknown` and narrow with Zod, or extract a typed interface.',
      });
    }
    if (/@ts-ignore/.test(line) && !line.trim().startsWith('//')) {
      out.push({
        check: 'no_typescript_any',
        severity: 'error',
        file: f.path,
        line: idx + 1,
        message: '@ts-ignore is forbidden. Fix the underlying type.',
      });
    }
  });
  return out;
}

function checkUnhandled(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|js|mjs|cjs)$/i.test(f.path)) return [];
  const out: QualityIssue[] = [];
  const lines = f.contents.split('\n');
  lines.forEach((line, idx) => {
    // catch a Promise call that ends with `)` and isn't awaited or chained with .catch
    const m = line.match(/^(?!.*\bawait\b).*\.(then|catch)\s*\(/);
    if (m && !/\.catch\s*\(/.test(line) && !/\.finally\s*\(/.test(line)) {
      // Heuristic only — skip if next line is .catch
      const next = lines[idx + 1] ?? '';
      if (!/\.catch\s*\(/.test(next)) {
        out.push({
          check: 'no_unhandled_promise_rejection',
          severity: 'warn',
          file: f.path,
          line: idx + 1,
          message: 'Promise without .catch — chain a .catch or wrap in try/await.',
        });
      }
    }
  });
  return out;
}

function checkLocalhost(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|tsx|js|mjs|cjs|json)$/i.test(f.path)) return [];
  if (f.path.startsWith('config/')) return []; // dev configs may legitimately mention localhost
  const out: QualityIssue[] = [];
  const lines = f.contents.split('\n');
  lines.forEach((line, idx) => {
    if (/['"`]localhost['"`]/.test(line) || /['"`]127\.0\.0\.1['"`]/.test(line)) {
      out.push({
        check: 'no_hardcoded_localhost',
        severity: 'warn',
        file: f.path,
        line: idx + 1,
        message: 'Hardcoded localhost will break inside the Blaxel sandbox. Read the host from env.',
      });
    }
  });
  return out;
}

function checkSyncFs(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|js|mjs|cjs)$/i.test(f.path)) return [];
  const out: QualityIssue[] = [];
  const lines = f.contents.split('\n');
  lines.forEach((line, idx) => {
    if (/\bfs\.(readFileSync|writeFileSync|readdirSync|statSync|mkdirSync)\s*\(/.test(line)) {
      out.push({
        check: 'no_synchronous_fs',
        severity: 'warn',
        file: f.path,
        line: idx + 1,
        message: 'Synchronous fs blocks the event loop. Use fs/promises with await.',
      });
    }
  });
  return out;
}

// ── Bundle-wide checks ─────────────────────────────────────────────────

function checkServerBootstrap(bundle: OperationBundle): QualityIssue[] {
  const out: QualityIssue[] = [];
  const server = bundle.files.find((f) => f.path === 'server.js' || f.path === 'src/server.ts');
  if (!server) {
    out.push({
      check: 'health_route_present',
      severity: 'error',
      file: '(bundle)',
      line: null,
      message: 'No server entry (server.js or src/server.ts). The Blaxel runtime won\'t boot.',
    });
    return out;
  }

  const health = bundle.files.some(
    (f) =>
      f.path === 'routes/health.js' ||
      f.path === 'src/routes/health.ts' ||
      /\/health/.test(f.contents),
  );
  if (!health) {
    out.push({
      check: 'health_route_present',
      severity: 'error',
      file: server.path,
      line: null,
      message: 'No /health route detected. Blaxel deploy will fail the health gate after 90s.',
    });
  }

  if (!/0\.0\.0\.0/.test(server.contents)) {
    out.push({
      check: 'binds_to_0_0_0_0',
      severity: 'error',
      file: server.path,
      line: null,
      message: 'Server must bind to host "0.0.0.0", not "localhost". The Blaxel preview can\'t reach localhost.',
    });
  }

  if (!/SIGTERM/.test(server.contents)) {
    out.push({
      check: 'sigterm_handler_present',
      severity: 'warn',
      file: server.path,
      line: null,
      message: 'No SIGTERM handler — the staging-swap will kill the process abruptly.',
    });
  }

  return out;
}

function checkPackageJson(bundle: OperationBundle): QualityIssue[] {
  const pkg = bundle.files.find((f) => f.path === 'package.json');
  if (!pkg) {
    return [
      {
        check: 'package_json_valid',
        severity: 'error',
        file: '(bundle)',
        line: null,
        message: 'Missing package.json. Generate it as the first scaffolding file.',
      },
    ];
  }
  try {
    const json = JSON.parse(pkg.contents) as { name?: string; type?: string; engines?: Record<string, string> };
    const issues: QualityIssue[] = [];
    if (!json.name) {
      issues.push({
        check: 'package_json_valid',
        severity: 'warn',
        file: pkg.path,
        line: null,
        message: 'package.json missing "name".',
      });
    }
    if (json.type && json.type !== 'module' && json.type !== 'commonjs') {
      issues.push({
        check: 'package_json_valid',
        severity: 'error',
        file: pkg.path,
        line: null,
        message: `package.json "type" must be "module" or "commonjs"; got "${json.type}".`,
      });
    }
    return issues;
  } catch (err) {
    return [
      {
        check: 'package_json_valid',
        severity: 'error',
        file: pkg.path,
        line: null,
        message: `package.json is not valid JSON: ${String(err).slice(0, 120)}`,
      },
    ];
  }
}

function checkRouteValidation(bundle: OperationBundle): QualityIssue[] {
  const out: QualityIssue[] = [];
  const routes = bundle.files.filter((f) => /^routes\/|^src\/routes\//.test(f.path) && /\.(ts|js)$/i.test(f.path));
  for (const r of routes) {
    if (r.path.endsWith('health.js') || r.path.endsWith('health.ts')) continue; // /health takes no body
    if (r.path.endsWith('approval.js') || r.path.endsWith('approval.ts')) continue; // GET-only by token
    const hasPost = /\.post\s*\(/.test(r.contents);
    const hasZod = /SubmissionSchema|z\.object|safeParse/.test(r.contents);
    if (hasPost && !hasZod) {
      out.push({
        check: 'every_route_has_zod_validation',
        severity: 'error',
        file: r.path,
        line: null,
        message: 'POST route without Zod validation. Every public input MUST go through safeParse before persisting.',
      });
    }
  }
  return out;
}

// ── v2 hardening: ten more security & operational checks ──────────────

function checkSqlConcatenation(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|tsx|js|mjs|cjs)$/i.test(f.path)) return [];
  const out: QualityIssue[] = [];
  const lines = f.contents.split('\n');
  // Detect template-literal SQL with interpolation OR string-concat building SQL.
  const SQL_KEYWORD = /\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i;
  lines.forEach((line, idx) => {
    const looksLikeSql = SQL_KEYWORD.test(line);
    if (!looksLikeSql) return;
    const hasInterpolation = /\$\{[^}]+\}/.test(line) || /'\s*\+\s*\w/.test(line);
    if (hasInterpolation && !/\?\s*=|\$\d/.test(line)) {
      out.push({
        check: 'no_sql_string_concatenation',
        severity: 'error',
        file: f.path,
        line: idx + 1,
        message:
          'SQL with interpolation/concatenation detected — use parameterised queries (\$1, \$2, …) or a query builder (kysely).',
      });
    }
  });
  return out;
}

function checkPrototypePollution(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|tsx|js|mjs|cjs)$/i.test(f.path)) return [];
  const out: QualityIssue[] = [];
  const lines = f.contents.split('\n');
  lines.forEach((line, idx) => {
    if (
      /\[\s*['"`](?:__proto__|constructor|prototype)['"`]\s*\]\s*=/.test(line) ||
      /Object\.assign\s*\(\s*\{\s*\}\s*,\s*req\.(?:body|query|params)\b/.test(line)
    ) {
      out.push({
        check: 'no_prototype_pollution',
        severity: 'error',
        file: f.path,
        line: idx + 1,
        message:
          'Possible prototype-pollution sink. Validate user input with Zod and copy fields explicitly; never spread req.body into a fresh object.',
      });
    }
  });
  return out;
}

function checkWeakCrypto(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|tsx|js|mjs|cjs)$/i.test(f.path)) return [];
  const out: QualityIssue[] = [];
  const lines = f.contents.split('\n');
  lines.forEach((line, idx) => {
    if (/createHash\s*\(\s*['"`](?:md5|sha1)['"`]/.test(line)) {
      out.push({
        check: 'no_weak_crypto',
        severity: 'error',
        file: f.path,
        line: idx + 1,
        message: 'MD5 / SHA-1 are forbidden. Use sha256 (createHash("sha256")) for hashes; bcrypt/argon2 for passwords.',
      });
    }
    if (/Math\.random\s*\(\s*\)/.test(line) && /token|secret|nonce|salt|password|otp|csrf/i.test(line)) {
      out.push({
        check: 'no_weak_crypto',
        severity: 'error',
        file: f.path,
        line: idx + 1,
        message: 'Math.random() is not cryptographically secure. Use node:crypto randomBytes for tokens/nonces/salts.',
      });
    }
  });
  return out;
}

function checkUnsafeRegex(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|tsx|js|mjs|cjs)$/i.test(f.path)) return [];
  const out: QualityIssue[] = [];
  const lines = f.contents.split('\n');
  // Common ReDoS patterns: nested quantifiers, alternation with overlapping groups.
  const REDOS = [
    /\([^)]*[+*]\s*\)\s*[+*]/, // (a+)+, (.*)+
    /\([^)]*[^)]\|[^)]*\)\s*[+*]/, // (a|a)+
  ];
  lines.forEach((line, idx) => {
    if (!/=\s*\/.+\/[gimsuy]*\b|new\s+RegExp\s*\(/.test(line)) return;
    for (const r of REDOS) {
      if (r.test(line)) {
        out.push({
          check: 'no_unsafe_regex',
          severity: 'warn',
          file: f.path,
          line: idx + 1,
          message:
            'Possible catastrophic-backtracking regex. Avoid nested quantifiers like (a+)+ or (.*)+; refactor to atomic groups or use a parser.',
        });
        break;
      }
    }
  });
  return out;
}

function checkPathTraversal(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|tsx|js|mjs|cjs)$/i.test(f.path)) return [];
  const out: QualityIssue[] = [];
  const lines = f.contents.split('\n');
  lines.forEach((line, idx) => {
    // path.join / fs.readFile with raw req.params or req.query input
    if (
      /(?:path\.join|path\.resolve|fs\.(?:read|write|create|append).*?)\s*\([^)]*\breq\.(?:params|query|body)\b/.test(line)
    ) {
      out.push({
        check: 'no_path_traversal_from_user_input',
        severity: 'error',
        file: f.path,
        line: idx + 1,
        message:
          'Possible path traversal — never pass req.params/req.query directly to fs.* or path.join. Validate against an allow-list or use a fixed lookup table.',
      });
    }
  });
  return out;
}

function checkXmlEntities(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|tsx|js|mjs|cjs)$/i.test(f.path)) return [];
  const out: QualityIssue[] = [];
  const lines = f.contents.split('\n');
  lines.forEach((line, idx) => {
    if (/new\s+(?:DOMParser|XMLParser|libxmljs)\b/.test(line) && !/no.?ent|disable.?entit|noent\s*:\s*true/i.test(line)) {
      out.push({
        check: 'no_xml_external_entities',
        severity: 'warn',
        file: f.path,
        line: idx + 1,
        message: 'XML parsing without explicit entity disabling. Pass { noent: false, dtd: false } or equivalent to prevent XXE.',
      });
    }
  });
  return out;
}

function checkSecretsInErrors(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|tsx|js|mjs|cjs)$/i.test(f.path)) return [];
  const out: QualityIssue[] = [];
  const lines = f.contents.split('\n');
  lines.forEach((line, idx) => {
    // throw new Error(...) or reply.send({error: ...}) that interpolates an env var
    if (
      /(?:throw\s+new\s+Error|reply\.send|res\.status|res\.send)\s*\([^)]*\bprocess\.env\.\w+/.test(line)
    ) {
      out.push({
        check: 'no_secrets_in_error_messages',
        severity: 'error',
        file: f.path,
        line: idx + 1,
        message:
          'Don\'t interpolate process.env values into error messages or HTTP responses. They leak to logs and clients.',
      });
    }
  });
  return out;
}

function checkOpenCors(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|tsx|js|mjs|cjs)$/i.test(f.path)) return [];
  const out: QualityIssue[] = [];
  const lines = f.contents.split('\n');
  lines.forEach((line, idx) => {
    if (
      /@fastify\/cors|cors\(\s*\{/.test(line) &&
      /origin\s*:\s*['"`]\*['"`]/.test(line)
    ) {
      out.push({
        check: 'no_open_cors_in_prod',
        severity: 'warn',
        file: f.path,
        line: idx + 1,
        message:
          'origin: "*" allows any site to call your API with cookies disabled. Restrict to the operator\'s allow-list once deployed.',
      });
    }
  });
  return out;
}

function checkHttpOutboundUrls(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|tsx|js|mjs|cjs)$/i.test(f.path)) return [];
  const out: QualityIssue[] = [];
  const lines = f.contents.split('\n');
  lines.forEach((line, idx) => {
    // request("http://… or fetch("http://… (skip localhost / 127.0.0.1)
    const m = line.match(/(?:request|fetch|undici\.request)\s*\(\s*['"`](http:\/\/[^'"`\s]+)/);
    if (m && !/localhost|127\.0\.0\.1|host\.docker\.internal/.test(m[1] ?? '')) {
      out.push({
        check: 'no_http_in_outbound_urls',
        severity: 'error',
        file: f.path,
        line: idx + 1,
        message: `Outbound HTTP (not HTTPS) to ${m[1]?.slice(0, 60)}. Use https:// — third-party APIs leak credentials over plain HTTP.`,
      });
    }
  });
  return out;
}

// ── v3: operational + reliability ──────────────────────────────────────

function checkMissingAwait(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|tsx|js|mjs|cjs)$/i.test(f.path)) return [];
  const out: QualityIssue[] = [];
  const lines = f.contents.split('\n');
  // async function calls used as statements (no await, no .then, no return).
  // Pattern: line that starts with `something(...)` where the function name is
  // in our known-async set. Conservative: only flag mongo / fetch / undici / fs/promises.
  const ASYNC_CALLERS = /\b(?:findOne|findOneAndUpdate|insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany|fetch|undici\.request|request|fs\.promises\.\w+)\s*\(/;
  lines.forEach((line, idx) => {
    if (/^\s*(?:await|return|const|let|var|throw|yield|\}|,)\b/.test(line)) return;
    if (/\.(then|catch|finally)\s*\(/.test(line)) return;
    if (ASYNC_CALLERS.test(line)) {
      out.push({
        check: 'no_missing_await_on_async',
        severity: 'warn',
        file: f.path,
        line: idx + 1,
        message:
          'Async call without await/.then/.catch — the result is dropped on the floor and errors swallow silently.',
      });
    }
  });
  return out;
}

function checkExposedStackTraces(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|tsx|js|mjs|cjs)$/i.test(f.path)) return [];
  const out: QualityIssue[] = [];
  const lines = f.contents.split('\n');
  lines.forEach((line, idx) => {
    if (
      /(?:reply\.send|res\.send|res\.json)\s*\([^)]*\b(?:err|error)\.stack\b/.test(line) ||
      /(?:reply\.send|res\.send|res\.json)\s*\([^)]*\bnew\s+Error\s*\([^)]*\)\s*\)/.test(line)
    ) {
      out.push({
        check: 'no_exposed_stack_traces',
        severity: 'error',
        file: f.path,
        line: idx + 1,
        message:
          'Don\'t send err.stack or raw Error objects to clients. Return a structured { error, message, requestId } body and log the stack server-side.',
      });
    }
  });
  return out;
}

function checkRequestLogger(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|tsx|js|mjs|cjs)$/i.test(f.path)) return [];
  // Only check route files.
  if (!/^routes\/|^src\/routes\//.test(f.path)) return [];
  const out: QualityIssue[] = [];
  const usesAppLog = /\bapp\.log\b|\breq\.log\b|\brequest\.log\b/.test(f.contents);
  if (!usesAppLog && f.contents.length > 400) {
    out.push({
      check: 'request_logger_in_handlers',
      severity: 'warn',
      file: f.path,
      line: null,
      message:
        'Route file has no req.log usage. Use req.log.info({...}) inside handlers so logs auto-correlate with the request id.',
    });
  }
  return out;
}

function checkRouteSetsContentType(f: OperationBundleFile): QualityIssue[] {
  if (!/^routes\/|^src\/routes\//.test(f.path)) return [];
  if (!/\.(ts|js)$/i.test(f.path)) return [];
  const out: QualityIssue[] = [];
  const lines = f.contents.split('\n');
  lines.forEach((line, idx) => {
    // reply.send(string) without a setContentType — emits text/plain by default.
    const m = line.match(/reply\.send\s*\(\s*['"`]/);
    if (m) {
      const surrounding = lines.slice(Math.max(0, idx - 6), idx + 1).join('\n');
      if (!/reply\.(?:type|header)\s*\(/.test(surrounding)) {
        out.push({
          check: 'route_sets_content_type',
          severity: 'warn',
          file: f.path,
          line: idx + 1,
          message:
            'Sending a string body without reply.type(...) — clients get text/plain. Set reply.type("application/json") or "text/html".',
        });
      }
    }
  });
  return out;
}

function checkHelmetRegistered(bundle: OperationBundle): QualityIssue[] {
  const server = bundle.files.find((f) => f.path === 'server.js' || f.path === 'src/server.ts');
  if (!server) return [];
  if (/@fastify\/helmet|require\(['"`]@fastify\/helmet['"`]\)|from\s+['"`]@fastify\/helmet['"`]/.test(server.contents))
    return [];
  return [
    {
      check: 'helmet_registered',
      severity: 'warn',
      file: server.path,
      line: null,
      message:
        '@fastify/helmet not registered — sets security headers (CSP, X-Frame-Options, HSTS) for free. Add: await app.register(helmet, { global: true }).',
    },
  ];
}

function checkBodyLimitSet(bundle: OperationBundle): QualityIssue[] {
  const server = bundle.files.find((f) => f.path === 'server.js' || f.path === 'src/server.ts');
  if (!server) return [];
  if (/bodyLimit\s*:\s*\d/.test(server.contents)) return [];
  return [
    {
      check: 'body_limit_set',
      severity: 'warn',
      file: server.path,
      line: null,
      message:
        'Fastify\'s default body limit is 1MB. Set { bodyLimit: 2_000_000 } (or your specific cap) explicitly so the limit is intentional.',
    },
  ];
}

function checkFastifyErrorHandler(bundle: OperationBundle): QualityIssue[] {
  const hasHandler = bundle.files.some(
    (f) => /\bsetErrorHandler\s*\(/.test(f.contents) && /\.(ts|js|mjs|cjs)$/i.test(f.path),
  );
  if (hasHandler) return [];
  const server = bundle.files.find((f) => f.path === 'server.js' || f.path === 'src/server.ts');
  if (!server) return [];
  return [
    {
      check: 'fastify_error_handler_set',
      severity: 'warn',
      file: server.path,
      line: null,
      message:
        'No app.setErrorHandler() — uncaught route errors emit Fastify\'s default 500 with no log shape. Set a handler that emits to the observability sidecar.',
    },
  ];
}

function checkMongoIndexes(bundle: OperationBundle): QualityIssue[] {
  // Find any file that creates a Mongo collection but never createIndex.
  const out: QualityIssue[] = [];
  const usesMongo = bundle.files.some((f) => /\bdb\.collection\(/.test(f.contents));
  if (!usesMongo) return [];
  const declaresIndexes = bundle.files.some(
    (f) => /createIndex\s*\(/.test(f.contents) || /ensureIndexes/.test(f.contents),
  );
  if (declaresIndexes) return [];
  return [
    {
      check: 'mongo_collection_has_indexes',
      severity: 'warn',
      file: '(bundle)',
      line: null,
      message:
        'Mongo collections used but no createIndex() calls anywhere. Add an indexes ensure-script (schema/indexes.js) that runs on boot.',
    },
  ];
}

function checkPublicRoutesHaveRateLimit(bundle: OperationBundle): QualityIssue[] {
  const out: QualityIssue[] = [];
  const routes = bundle.files.filter(
    (f) => /^routes\/|^src\/routes\//.test(f.path) && /\.(ts|js)$/i.test(f.path),
  );
  for (const r of routes) {
    if (
      r.path.endsWith('health.js') ||
      r.path.endsWith('health.ts') ||
      r.path.endsWith('internal.js') ||
      r.path.endsWith('internal.ts')
    )
      continue;
    const hasPostOrPut = /\.(post|put|patch)\s*\(/.test(r.contents);
    const hasRateLimit = /rateLimit\b|rate-limit|@fastify\/rate-limit|RATE\s*=/i.test(r.contents);
    if (hasPostOrPut && !hasRateLimit) {
      out.push({
        check: 'public_post_routes_have_rate_limit',
        severity: 'warn',
        file: r.path,
        line: null,
        message:
          'POST/PUT/PATCH route without an explicit rate limit. Add { config: { rateLimit: { max, timeWindow } } } so a bot can\'t exhaust the operation.',
      });
    }
  }
  return out;
}

// ── Auto-fix prompt composer ───────────────────────────────────────────

function composeAutoFixPrompt(issues: QualityIssue[]): string {
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length === 0) return '';
  const lines: string[] = [];
  lines.push('# Quality gate failed — fix these errors before deploying.');
  lines.push('');
  lines.push('Each item below is a hard error. Re-emit the affected files with <dyad-write>');
  lines.push('to fix every one. Do not introduce new files; do not modify untouched files.');
  lines.push('');
  for (const issue of errors) {
    const where = issue.line ? `${issue.file}:${issue.line}` : issue.file;
    lines.push(`- [${issue.check}] ${where} — ${issue.message}`);
  }
  return lines.join('\n');
}
