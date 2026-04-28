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
  | 'request_logger_in_handlers'
  // ── v4 hardening (Day 4 part 20): documentation, env, agent SDK ──
  | 'readme_with_architecture_diagram'
  | 'env_example_documents_every_var'
  | 'eval_suite_present_when_llm_used'
  | 'no_dotenv_import_in_production_code'
  | 'no_unhandled_zod_safe_parse'
  | 'no_async_in_top_level_route_handlers_without_try'
  | 'agent_sdk_used_when_llm_called'
  | 'mailer_uses_escape_for_email'
  // ── v5 hardening (Day 4 part 22): agent-build invariants ──
  | 'agent_name_unique_in_bundle'
  | 'tool_name_unique_in_bundle'
  | 'agent_has_output_schema'
  | 'workflow_steps_have_names'
  | 'durable_workflow_step_idempotency'
  // ── v6 hardening: parser-level + bug-hunting checks ──
  | 'bundle_syntax_valid'
  | 'route_handler_returns_or_replies'
  | 'await_on_async_db_call'
  | 'zod_parse_before_mutation'
  | 'no_console_log_in_routes'
  | 'try_catch_logs_error';

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

  // v6: parser-level syntax validity is the FIRST gate — if a file is
  // syntactically broken, the rest of the regex-based checks will produce
  // misleading noise, and the deploy would crash on first import anyway.
  // Running this first lets the auto-fix loop see the parse error first.
  for (const file of bundle.files) {
    issues.push(...checkSyntaxValid(file));
  }

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
  // v4 hardening — documentation + agent SDK invariants
  issues.push(...checkReadmeArchitectureDiagram(bundle));
  issues.push(...checkEnvExampleCoverage(bundle));
  issues.push(...checkEvalSuitePresentWhenLlmUsed(bundle));
  issues.push(...checkAgentSdkUsedWhenLlmCalled(bundle));
  issues.push(...checkMailerUsesEscape(bundle));
  // v5 hardening — agent-build invariants
  issues.push(...checkAgentNameUniqueness(bundle));
  issues.push(...checkToolNameUniqueness(bundle));
  issues.push(...checkAgentOutputSchema(bundle));
  issues.push(...checkWorkflowStepsHaveNames(bundle));
  issues.push(...checkDurableWorkflowIdempotency(bundle));
  // v6 hardening — bug-hunting checks per file
  for (const file of bundle.files) {
    issues.push(...checkRouteHandlerReturnsOrReplies(file));
    issues.push(...checkAwaitOnAsyncDbCall(file));
    issues.push(...checkZodParseBeforeMutation(file));
    issues.push(...checkNoConsoleLogInRoutes(file));
    issues.push(...checkTryCatchLogsError(file));
  }
  for (const file of bundle.files) {
    issues.push(...checkNoDotenvImport(file));
    issues.push(...checkNoUnhandledZodSafeParse(file));
    issues.push(...checkAsyncRouteHandlersHaveErrorBoundary(file));
  }

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

// ── v4 hardening: documentation + agent SDK invariants ───────────────

/**
 * README.md must exist AND contain a fenced mermaid block (the
 * BUILD_SYSTEM_PROMPT v2 mandate). Even fullstack apps need this — the
 * mermaid is the diagram a non-engineer reviewer sees first.
 */
function checkReadmeArchitectureDiagram(bundle: OperationBundle): QualityIssue[] {
  // Trivial bundles (sub-5 files, e.g. health-only stubs) are exempt —
  // the README mandate is for real production builds.
  if (bundle.files.length < 5) return [];
  const readme = bundle.files.find((f) => f.path === 'README.md' || f.path === 'readme.md');
  if (!readme) {
    return [{
      check: 'readme_with_architecture_diagram',
      severity: 'warn',
      file: 'README.md',
      line: null,
      message: 'README.md is missing. Every Argo bundle ships a README with a plain-English summary + a mermaid architecture diagram.',
    }];
  }
  if (!/```mermaid[\s\S]+?```/i.test(readme.contents)) {
    return [{
      check: 'readme_with_architecture_diagram',
      severity: 'warn',
      file: readme.path,
      line: 1,
      message: 'README.md exists but is missing a ```mermaid``` fenced block. Add one showing routes -> handlers -> services so a reviewer can read the architecture in 10 seconds.',
    }];
  }
  return [];
}

/**
 * .env.example must exist AND every env var process.env.<X> referenced
 * in code must be documented (i.e. appear as a key on its own line).
 */
function checkEnvExampleCoverage(bundle: OperationBundle): QualityIssue[] {
  // Trivial bundles are exempt.
  if (bundle.files.length < 5) return [];
  const envFile = bundle.files.find((f) => f.path === '.env.example' || f.path === 'env.example');
  if (!envFile) {
    return [{
      check: 'env_example_documents_every_var',
      severity: 'warn',
      file: '.env.example',
      line: null,
      message: '.env.example is missing. Document every env var the code reads, with an inline comment per var.',
    }];
  }
  const referenced = new Set<string>();
  const ENV_RE = /process\.env\.([A-Z][A-Z0-9_]*)/g;
  for (const f of bundle.files) {
    if (!/\.(?:m?[jt]sx?|cjs)$/i.test(f.path)) continue;
    let m: RegExpExecArray | null;
    ENV_RE.lastIndex = 0;
    while ((m = ENV_RE.exec(f.contents)) !== null) {
      referenced.add(m[1]!);
    }
  }
  // Implicit always-present env vars Argo's runtime injects — never have
  // to be documented in .env.example because the operator never sets them.
  const RUNTIME_INJECTED = new Set([
    'NODE_ENV', 'PORT', 'LOG_LEVEL', 'TZ',
    'ARGO_OPERATION_ID', 'ARGO_ENVIRONMENT', 'ARGO_CONTROL_PLANE_URL',
    'ARGO_TEST_MODE', 'ARGO_OWNER_ID',
  ]);
  const missing: string[] = [];
  for (const name of referenced) {
    if (RUNTIME_INJECTED.has(name)) continue;
    const declared = new RegExp(`^\\s*${name}\\s*=`, 'm').test(envFile.contents);
    if (!declared) missing.push(name);
  }
  if (missing.length === 0) return [];
  return [{
    check: 'env_example_documents_every_var',
    severity: 'warn',
    file: envFile.path,
    line: null,
    message: `.env.example does not document: ${missing.join(', ')}. Add a key=placeholder line for each (with a one-line comment describing what it's for).`,
  }];
}

/**
 * If any code file imports an LLM SDK, openai client, or hits the
 * /chat/completions endpoint, then tests/eval-suite.js MUST exist.
 * No LLM-using app ships untested.
 */
function checkEvalSuitePresentWhenLlmUsed(bundle: OperationBundle): QualityIssue[] {
  const usesLlm = bundle.files.some((f) => {
    if (!/\.(?:m?[jt]sx?|cjs)$/i.test(f.path)) return false;
    return /(\bopenai\b|chat\/completions|anthropic\.com|claude-|@anthropic-ai)/i.test(f.contents);
  });
  if (!usesLlm) return [];
  const hasEval = bundle.files.some((f) =>
    f.path === 'tests/eval-suite.js' || f.path === 'tests/eval-suite.mjs' || f.path === 'tests/eval.test.js',
  );
  if (hasEval) return [];
  return [{
    check: 'eval_suite_present_when_llm_used',
    severity: 'error',
    file: 'tests/eval-suite.js',
    line: null,
    message: 'This bundle calls an LLM but ships no tests/eval-suite.js. LLM-using code without an eval suite is untestable. Add the spec-as-tests harness (see reference snippet agent-eval-suite).',
  }];
}

/**
 * No file should `import 'dotenv'` or `require('dotenv')`. Argo's
 * runtime sets env vars via Blaxel sandbox metadata; dotenv is a dev
 * artifact that leaks `.env` files when copied.
 */
function checkNoDotenvImport(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(?:m?[jt]sx?|cjs)$/i.test(f.path)) return [];
  const lines = f.contents.split('\n');
  const issues: QualityIssue[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/(?:^|\b)import\s+(?:[*\w{},\s]+\s+from\s+)?['"]dotenv(?:\/[^'"]+)?['"]/.test(line) ||
        /require\(\s*['"]dotenv(?:\/[^'"]+)?['"]\s*\)/.test(line)) {
      issues.push({
        check: 'no_dotenv_import_in_production_code',
        severity: 'error',
        file: f.path,
        line: i + 1,
        message: 'dotenv is forbidden in generated code. Argo injects env via Blaxel sandbox metadata; reading process.env directly is enough.',
      });
    }
  }
  return issues;
}

/**
 * `.safeParse(...)` results must be checked. A bare safeParse result
 * that's never read is a guarantee of a runtime crash later.
 */
function checkNoUnhandledZodSafeParse(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(?:m?[jt]sx?|cjs)$/i.test(f.path)) return [];
  const lines = f.contents.split('\n');
  const issues: QualityIssue[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Only flag when safeParse appears as a bare expression statement
    // (no const/let/var binding, no `if (...)`, no `?` chain consumer).
    const m = /^\s*\w+\.safeParse\s*\(/.exec(line);
    if (m && !/^\s*(const|let|var|if|return|await|throw|export|=>)/.test(line)) {
      issues.push({
        check: 'no_unhandled_zod_safe_parse',
        severity: 'error',
        file: f.path,
        line: i + 1,
        message: 'safeParse() result is not assigned or checked. Either bind to a variable and check .success, or use .parse() to throw on invalid input.',
      });
    }
  }
  return issues;
}

/**
 * Every async route handler should either be inside a try/catch or
 * the file should have a Fastify setErrorHandler somewhere — otherwise
 * unhandled rejections produce 500s with stack traces in the response.
 */
function checkAsyncRouteHandlersHaveErrorBoundary(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(?:m?[jt]sx?|cjs)$/i.test(f.path)) return [];
  if (!/app\.(get|post|put|patch|delete)\s*\(/.test(f.contents)) return [];
  // Fastify v4 auto-handles rejections IF setErrorHandler is registered.
  // We accept either: an explicit try/catch in the handler, OR a
  // setErrorHandler in the same file or in any other file in the bundle.
  // The bundle-wide setErrorHandler check (checkFastifyErrorHandler)
  // catches the latter case; here we only flag handlers that are
  // ARROW functions with NO try and NO outer error handler in the file.
  const lines = f.contents.split('\n');
  const issues: QualityIssue[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // async (req, reply) => { followed by no try/catch in the next ~15 lines
    if (/async\s*\([^)]*\)\s*=>\s*\{/.test(line)) {
      const block = lines.slice(i, Math.min(lines.length, i + 25)).join('\n');
      const hasTry = /\btry\s*\{/.test(block);
      const fileHasErrorHandler = /setErrorHandler/.test(f.contents);
      if (!hasTry && !fileHasErrorHandler) {
        issues.push({
          check: 'no_async_in_top_level_route_handlers_without_try',
          severity: 'warn',
          file: f.path,
          line: i + 1,
          message: 'Async route handler with no try/catch and no setErrorHandler in this file. Wrap in try/catch or rely on a bundle-wide setErrorHandler — but make sure one exists.',
        });
      }
    }
  }
  return issues;
}

/**
 * If LLM endpoints are called raw (chat/completions), the agent SDK
 * snippet wasn't used. Flag as warn so the agent SDK pattern is the
 * default. Errors-only bypass when the file is the SDK itself.
 */
function checkAgentSdkUsedWhenLlmCalled(bundle: OperationBundle): QualityIssue[] {
  const sdkPaths = new Set([
    'lib/agent/index.js',
    'lib/agent/index.ts',
    'agent/index.js',
    'src/agent/index.js',
  ]);
  const sdkPresent = bundle.files.some((f) => sdkPaths.has(f.path));
  if (sdkPresent) return [];
  // Find raw chat/completions calls outside any /agent/ folder.
  const issues: QualityIssue[] = [];
  for (const f of bundle.files) {
    if (!/\.(?:m?[jt]sx?|cjs)$/i.test(f.path)) continue;
    if (f.path.includes('/agent/') || f.path.includes('/lib/agent')) continue;
    if (/chat\/completions|messages.create\(|anthropic\.messages/.test(f.contents)) {
      issues.push({
        check: 'agent_sdk_used_when_llm_called',
        severity: 'warn',
        file: f.path,
        line: null,
        message: 'Raw chat/completions call found, but no lib/agent/index.js exists. Generated apps should call createAgent() from the inline agent SDK instead — gives them retry, schema validation, cost tracking, and replay for free.',
      });
    }
  }
  return issues;
}

/**
 * Mailer template files must call escapeForEmail() on every interpolated
 * value. Argo's invariants require this; a generated mailer that
 * concatenates raw user input is an XSS-into-email-clients waiting room.
 */
function checkMailerUsesEscape(bundle: OperationBundle): QualityIssue[] {
  const mailerFiles = bundle.files.filter((f) =>
    /(^|\/)(mailer|email)\/.*\.(m?js|ts)$/i.test(f.path) &&
    !/templates?\.test|\.test\./i.test(f.path),
  );
  const issues: QualityIssue[] = [];
  for (const f of mailerFiles) {
    if (!/\$\{[^}]+\}/.test(f.contents)) continue;            // no interpolation, no risk
    if (!/escapeForEmail|escapeHtml|sanitize/i.test(f.contents)) {
      issues.push({
        check: 'mailer_uses_escape_for_email',
        severity: 'error',
        file: f.path,
        line: null,
        message: 'Mailer template interpolates values but never calls escapeForEmail(). Wrap every ${...} in escapeForEmail() — cribbing user input straight into HTML email is an XSS risk.',
      });
    }
  }
  return issues;
}

// ── v5 hardening: agent-build invariants ─────────────────────────────

const FILE_RE = /\.(?:m?[jt]sx?|cjs)$/i;

/**
 * Two agents with the same `name` produce identical entries in the
 * agent_invocations cost ledger. The Replay tab can't distinguish them.
 * Catches a common LLM failure where it pastes the same agent block twice.
 */
function checkAgentNameUniqueness(bundle: OperationBundle): QualityIssue[] {
  const seen = new Map<string, string[]>();
  for (const f of bundle.files) {
    if (!FILE_RE.test(f.path)) continue;
    const re = /createAgent\s*\(\s*\{[^}]*?name\s*:\s*['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(f.contents)) !== null) {
      const name = m[1] ?? '';
      if (!seen.has(name)) seen.set(name, []);
      seen.get(name)!.push(f.path);
    }
  }
  const issues: QualityIssue[] = [];
  for (const [name, paths] of seen) {
    if (paths.length <= 1) continue;
    issues.push({
      check: 'agent_name_unique_in_bundle',
      severity: 'error',
      file: paths[0]!,
      line: null,
      message: `Agent name "${name}" is declared in ${paths.length} files: ${paths.join(', ')}. Two agents with the same name conflict in the cost ledger and the Replay tab. Rename one.`,
    });
  }
  return issues;
}

/**
 * Same problem as agents but for tools registered via defineTool.
 * Two tools with the same name → only one is reachable; the other is
 * dead code that confuses the audit trail.
 */
function checkToolNameUniqueness(bundle: OperationBundle): QualityIssue[] {
  const seen = new Map<string, string[]>();
  for (const f of bundle.files) {
    if (!FILE_RE.test(f.path)) continue;
    const re = /defineTool\s*\(\s*\{[^}]*?name\s*:\s*['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(f.contents)) !== null) {
      const name = m[1] ?? '';
      if (!seen.has(name)) seen.set(name, []);
      seen.get(name)!.push(f.path);
    }
  }
  const issues: QualityIssue[] = [];
  for (const [name, paths] of seen) {
    if (paths.length <= 1) continue;
    issues.push({
      check: 'tool_name_unique_in_bundle',
      severity: 'error',
      file: paths[0]!,
      line: null,
      message: `Tool name "${name}" is declared in ${paths.length} files: ${paths.join(', ')}. Tool names must be unique within a bundle. Rename one.`,
    });
  }
  return issues;
}

/**
 * createAgent({ ... }) without an outputSchema is an unbounded freeform
 * LLM call masquerading as a typed function. The whole point of the
 * agent SDK is structured output validation. Flag every agent without
 * a schema.
 */
function checkAgentOutputSchema(bundle: OperationBundle): QualityIssue[] {
  const issues: QualityIssue[] = [];
  for (const f of bundle.files) {
    if (!FILE_RE.test(f.path)) continue;
    // Match createAgent({ ... }) blocks, including multi-line content.
    const re = /createAgent\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(f.contents)) !== null) {
      const block = m[1] ?? '';
      const nameMatch = block.match(/name\s*:\s*['"]([^'"]+)['"]/);
      const name = nameMatch ? nameMatch[1] : '(unnamed)';
      if (!/outputSchema\s*:/.test(block)) {
        issues.push({
          check: 'agent_has_output_schema',
          severity: 'error',
          file: f.path,
          line: null,
          message: `Agent "${name}" has no outputSchema. Every createAgent() must declare a Zod schema for the response — that's how runAgent retries on schema mismatch and how the cost ledger captures shape.`,
        });
      }
    }
  }
  return issues;
}

/**
 * defineWorkflow('name', [{ ... }, { ... }]) where any step is missing
 * a `name` makes resume-after-crash unreliable — the workflow runner
 * persists progress by step name. Anonymous steps look identical on
 * disk and the runner re-executes them all.
 */
function checkWorkflowStepsHaveNames(bundle: OperationBundle): QualityIssue[] {
  const issues: QualityIssue[] = [];
  for (const f of bundle.files) {
    if (!FILE_RE.test(f.path)) continue;
    const re = /defineWorkflow\s*\(\s*['"]([^'"]+)['"]\s*,\s*\[([\s\S]*?)\]\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(f.contents)) !== null) {
      const wfName = m[1] ?? '(unnamed)';
      const body = m[2] ?? '';
      // Count step blocks by counting `{ ... run:` occurrences.
      const stepStarts = (body.match(/\{\s*[^}]*?run\s*:/g) ?? []).length;
      const namedSteps = (body.match(/name\s*:\s*['"][^'"]+['"]/g) ?? []).length;
      if (stepStarts > 0 && namedSteps < stepStarts) {
        issues.push({
          check: 'workflow_steps_have_names',
          severity: 'error',
          file: f.path,
          line: null,
          message: `Workflow "${wfName}" has ${stepStarts} steps but only ${namedSteps} are named. Every defineWorkflow step needs a unique name — the runner persists progress by name and resume-after-crash relies on it.`,
        });
      }
    }
  }
  return issues;
}

/**
 * The durable workflow snippet says steps must be IDEMPOTENT (same args
 * → same return). Operators use these for billing flows where double-
 * charging is catastrophic. Flag any workflow step whose run function
 * uses Math.random / Date.now / crypto.randomUUID without seeding.
 */
function checkDurableWorkflowIdempotency(bundle: OperationBundle): QualityIssue[] {
  const issues: QualityIssue[] = [];
  for (const f of bundle.files) {
    if (!FILE_RE.test(f.path)) continue;
    if (!/defineWorkflow\s*\(/.test(f.contents)) continue;
    const lines = f.contents.split('\n');
    let inWorkflow = false;
    let braceDepth = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (/defineWorkflow\s*\(/.test(line)) inWorkflow = true;
      if (inWorkflow) {
        braceDepth += (line.match(/\{/g) ?? []).length;
        braceDepth -= (line.match(/\}/g) ?? []).length;
        if (
          /\bMath\.random\(|\bDate\.now\(|\bcrypto\.randomUUID\(/.test(line) &&
          // Skip lines that look like step args being passed (they're idempotent
          // in the args, not in the run).
          !/\bargs\.|input\.|ctx\./.test(line)
        ) {
          issues.push({
            check: 'durable_workflow_step_idempotency',
            severity: 'warn',
            file: f.path,
            line: i + 1,
            message: `Workflow step uses Math.random/Date.now/randomUUID. Durable workflow steps must be idempotent — same input must produce same output. Move non-determinism into the input args, OR seed it from runId/stepName.`,
          });
        }
        if (braceDepth <= 0 && /^\s*\)\s*;?\s*$/.test(line)) {
          inWorkflow = false;
          braceDepth = 0;
        }
      }
    }
  }
  return issues;
}

// ── v6 hardening: parser-level + bug-hunting checks ──────────────────

/**
 * Parse every JS/TS file in the bundle. A syntax error means the deploy
 * will crash on its first import — failing here lets the repair loop see
 * the parser message immediately instead of debugging a runtime crash.
 *
 * We use Function() with a leading "return" expression to validate
 * arbitrary statement-level JS (no eval, no execution — Function only
 * parses; throwing happens when the parser hits a SyntaxError). For TS
 * files we lightweight-parse by stripping the obvious type-only constructs
 * before re-checking syntax, since we don't want to ship the full TS
 * compiler in this package's hot path.
 */
function checkSyntaxValid(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|tsx|js|mjs|cjs|jsx)$/i.test(f.path)) return [];
  if (f.contents.length === 0) return [];

  // Strip a #!/usr/bin/env node shebang if present — Function() can't parse it.
  let src = f.contents.startsWith('#!') ? '// ' + f.contents : f.contents;

  // Strip ESM module-level constructs that Function() can't accept.
  // Function bodies are CommonJS-flavored, so we need to demodule the source
  // before parsing. We only care about syntax validity — not semantics.
  src = stripEsmForParse(src);

  // For TS/TSX, strip type annotations heuristically. This is imperfect
  // (it won't catch all parse errors a real compiler would) but it
  // catches the common LLM mistakes: stray commas, unclosed braces,
  // missing parens, runaway template literals.
  if (/\.tsx?$/i.test(f.path)) {
    src = stripTsTypesForParse(src);
  }

  try {
    // The 'return' lets Function() accept top-level statements. We never
    // call the resulting fn — Function only PARSES the body, throwing
    // SyntaxError on bad input.
    new Function(src);
    return [];
  } catch (e) {
    if (e instanceof SyntaxError) {
      const msg = e.message.slice(0, 200);
      return [
        {
          check: 'bundle_syntax_valid',
          severity: 'error',
          file: f.path,
          line: extractLineFromSyntaxError(msg),
          message: `Parse error: ${msg}. The file is syntactically broken — the deploy will crash on first import.`,
        },
      ];
    }
    return [];
  }
}

/** Strip ESM module-level constructs so Function() can parse the body. */
function stripEsmForParse(src: string): string {
  let out = src;
  // import "..."; (side-effect imports)
  out = out.replace(/^\s*import\s+['"][^'"]+['"]\s*;?\s*$/gm, '');
  // import X from "..."; / import { x, y } from "..."; / import * as N from "...";
  // / import type { ... } from "..."; — covers all named/default/namespace forms
  out = out.replace(/^\s*import\s+(?:type\s+)?[^;]+\s+from\s+['"][^'"]+['"]\s*;?\s*$/gm, '');
  // export const / export let / export var / export function / export class /
  // export async function / export interface / export type / export enum
  out = out.replace(
    /\bexport\s+(?=(?:default\s+)?(?:const|let|var|function|class|async|interface|type|enum|abstract))/g,
    '',
  );
  // export default <expression>;
  out = out.replace(/\bexport\s+default\s+/g, '(0,');
  // The above turns `export default X;` into `(0,X;` — close it. Simpler:
  // re-handle with a cleaner pass.
  out = out.replace(/\(0,([\s\S]*?);/g, '$1;');
  // export { a, b } / export { a as b } / export { a } from "..."
  out = out.replace(/^\s*export\s*\{[\s\S]*?\}\s*(?:from\s+['"][^'"]+['"])?\s*;?\s*$/gm, '');
  // export * from "...";
  out = out.replace(/^\s*export\s+\*\s+from\s+['"][^'"]+['"]\s*;?\s*$/gm, '');
  return out;
}

/** Best-effort: strip TS type annotations so Function() can parse the JS. */
function stripTsTypesForParse(src: string): string {
  let out = src;
  // Remove `: Type` from var/param decls (greedy until comma/parens/eq/eol).
  // This is a heuristic — won't catch generic param lists or complex unions
  // but handles 90% of the LLM-written code we see.
  out = out.replace(/:\s*[A-Za-z_$][\w$<>[\]|&,\s.'"]*?(?=[=,)\];\n])/g, '');
  // Remove `as Type` and `as const`.
  out = out.replace(/\s+as\s+[A-Za-z_$][\w$<>[\]|&.\s]*/g, '');
  // Remove `interface X { ... }`.
  out = out.replace(/\binterface\s+[A-Za-z_$][\w$]*\s*\{[\s\S]*?\}/g, '');
  // Remove `type X = ...;`.
  out = out.replace(/\btype\s+[A-Za-z_$][\w$]*\s*=\s*[^;]+;/g, '');
  // Remove generic params on calls: foo<T>() -> foo()
  out = out.replace(/<[A-Z][\w<>,\s|&]*>(?=\()/g, '');
  // Remove `import type { ... }`.
  out = out.replace(/^\s*import\s+type\s+[^;]+;\s*$/gm, '');
  // Strip `!` non-null assertion.
  out = out.replace(/(\w)!(\.|,|\)|;|\s|=)/g, '$1$2');
  return out;
}

function extractLineFromSyntaxError(msg: string): number | null {
  const m = msg.match(/line (\d+)/i);
  return m && m[1] ? parseInt(m[1], 10) : null;
}

/**
 * Every Fastify route handler must either `return` a value or call
 * `reply.send()` / `reply.code().send()`. A handler that does neither
 * leaves the request hanging until the connection times out.
 */
function checkRouteHandlerReturnsOrReplies(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|tsx|js|mjs|cjs|jsx)$/i.test(f.path)) return [];
  if (f.path.startsWith('web/')) return [];
  const issues: QualityIssue[] = [];
  // Match: app.get/post/put/patch/delete('/path', { schema }, async (req, reply) => { ... })
  // OR:    app.get('/path', async (req, reply) => { ... })
  const routeRe =
    /\bapp\.(get|post|put|patch|delete)\s*\([^,]+,(?:[^,]+,)?\s*async\s*\(([^)]*)\)\s*=>\s*\{([\s\S]*?)\n\s*\}\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = routeRe.exec(f.contents)) !== null) {
    const body = m[3] ?? '';
    const hasReturn = /(^|\n|\s)return\b/.test(body);
    const hasReplySend = /\breply\.(?:code\s*\(\s*\d+\s*\)\s*\.\s*)?send\s*\(/.test(body);
    const hasReplyRedirect = /\breply\.redirect\s*\(/.test(body);
    if (!hasReturn && !hasReplySend && !hasReplyRedirect) {
      const lineNo = f.contents.slice(0, m.index).split('\n').length;
      issues.push({
        check: 'route_handler_returns_or_replies',
        severity: 'error',
        file: f.path,
        line: lineNo,
        message:
          `Route handler ${m[1]?.toUpperCase()} body neither returns nor calls reply.send/redirect. ` +
          `Fastify will hang the request until timeout. End the handler with a return statement or reply.send(...).`,
      });
    }
  }
  return issues;
}

/**
 * MongoDB driver methods are async — calling them without await yields
 * an unawaited Promise, the route returns prematurely, and the operation
 * either silently fails or races its successor. Catches the common LLM
 * forgotten-await pattern.
 */
function checkAwaitOnAsyncDbCall(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|tsx|js|mjs|cjs|jsx)$/i.test(f.path)) return [];
  const issues: QualityIssue[] = [];
  const lines = f.contents.split('\n');
  // Methods on the Mongo Collection that return a Promise.
  const ASYNC_METHODS = [
    'insertOne', 'insertMany', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany',
    'replaceOne', 'findOne', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
    'countDocuments', 'distinct', 'aggregate', 'createIndex', 'bulkWrite',
  ];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Skip comments.
    if (/^\s*\/\//.test(line)) continue;
    for (const method of ASYNC_METHODS) {
      // pattern: ".methodName(" preceded by a word char (collection ref)
      const re = new RegExp(`(\\w)\\.${method}\\s*\\(`);
      if (!re.test(line)) continue;
      // Already awaited? (await before, or `.then(` after the call, or `return` to chain)
      if (/\bawait\b/.test(line)) continue;
      if (/\)\s*\.\s*then\s*\(/.test(line)) continue;
      if (/^\s*return\s/.test(line)) continue;
      // An assignment to a non-promise variable like `const x = col.findOne()`
      // without await is a bug. Allow `const x = await ...` (covered above).
      // Also allow `Promise.all([col.findOne(), ...])` style.
      if (/\bPromise\.(all|race|allSettled|any)\s*\(/.test(line)) continue;
      issues.push({
        check: 'await_on_async_db_call',
        severity: 'warn',
        file: f.path,
        line: i + 1,
        message:
          `'${method}' returns a Promise but isn't awaited. The Promise resolves after the route returns; ` +
          `state changes may not happen before the response. Add 'await' (or chain .then()).`,
      });
      break;
    }
  }
  return issues;
}

/**
 * Mutation routes (POST/PATCH/PUT/DELETE) must validate the request body
 * with zod BEFORE any database write. Skipping validation lets malformed
 * input land in the DB and propagate corruption.
 */
function checkZodParseBeforeMutation(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|tsx|js|mjs|cjs|jsx)$/i.test(f.path)) return [];
  if (f.path.startsWith('web/')) return [];
  const issues: QualityIssue[] = [];
  // The file imports zod? Any `.parse(req.body)` then counts as validation.
  const fileImportsZod = /from\s+['"]zod['"]|require\s*\(\s*['"]zod['"]\s*\)/.test(f.contents);
  const routeRe =
    /\bapp\.(post|put|patch|delete)\s*\([^,]+,(?:[^,]+,)?\s*async\s*\([^)]*\)\s*=>\s*\{([\s\S]*?)\n\s*\}\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = routeRe.exec(f.contents)) !== null) {
    const body = m[2] ?? '';
    const hasMutation =
      /\.(insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany|replaceOne|findOneAndUpdate)\s*\(/.test(body);
    if (!hasMutation) continue;
    // Strict: schema-named identifier with .parse(
    const hasNamedZod = /\b(?:[A-Z]\w*Schema|z\.\w+|\w+Schema)\.(?:parse|safeParse)\s*\(/.test(body);
    // Loose: file imports zod AND the body has any `.parse(` or `.safeParse(`.
    const hasLooseZod = fileImportsZod && /\b\w+\.(?:parse|safeParse)\s*\(/.test(body);
    const hasZod = hasNamedZod || hasLooseZod;
    // Fastify route schema config also counts (validates before handler runs).
    // Look for ", { schema: " in the call args.
    const openParen = m.index;
    const callSlice = f.contents.slice(openParen, openParen + 400);
    const hasFastifySchema = /,\s*\{\s*schema\s*:/.test(callSlice);
    if (!hasZod && !hasFastifySchema) {
      const lineNo = f.contents.slice(0, openParen).split('\n').length;
      issues.push({
        check: 'zod_parse_before_mutation',
        severity: 'warn',
        file: f.path,
        line: lineNo,
        message:
          `Mutation route ${m[1]?.toUpperCase()} writes to the DB without validating the body with zod. ` +
          `Add a Schema.parse(req.body) (or a Fastify { schema } config) before the write.`,
      });
    }
  }
  return issues;
}

/**
 * Inside a route handler, console.log bypasses pino, so the log line is
 * un-correlated to the request and the activity feed misses it. Use
 * req.log.info / req.log.error instead. (Distinct from the global
 * no_console_log check — this one targets console specifically inside
 * route handlers, where the cost is highest.)
 */
function checkNoConsoleLogInRoutes(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|tsx|js|mjs|cjs|jsx)$/i.test(f.path)) return [];
  if (f.path.startsWith('web/')) return [];
  const issues: QualityIssue[] = [];
  const routeRe =
    /\bapp\.(get|post|put|patch|delete)\s*\([^,]+,(?:[^,]+,)?\s*async\s*\([^)]*\)\s*=>\s*\{([\s\S]*?)\n\s*\}\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = routeRe.exec(f.contents)) !== null) {
    const body = m[2] ?? '';
    const consoleMatch = body.match(/\bconsole\.(log|info|debug|warn|error)\s*\(/);
    if (consoleMatch) {
      const lineOfMatch = body.slice(0, consoleMatch.index).split('\n').length;
      const startLine = f.contents.slice(0, m.index).split('\n').length;
      issues.push({
        check: 'no_console_log_in_routes',
        severity: 'warn',
        file: f.path,
        line: startLine + lineOfMatch - 1,
        message:
          `Route handler uses console.${consoleMatch[1]}. Use req.log.${consoleMatch[1] === 'log' ? 'info' : consoleMatch[1]}() instead — pino correlates the line to the request id and the activity feed picks it up.`,
      });
    }
  }
  return issues;
}

/**
 * A try/catch that does NOTHING (no log, no rethrow, no reply.send) silently
 * swallows the error, leaving the operator with no signal that something
 * went wrong. We require the catch body to either call a logger, rethrow,
 * or send an error response.
 */
function checkTryCatchLogsError(f: OperationBundleFile): QualityIssue[] {
  if (!/\.(ts|tsx|js|mjs|cjs|jsx)$/i.test(f.path)) return [];
  const issues: QualityIssue[] = [];
  // Match: catch (err) { ... } with body content. Allow any identifier as the binding.
  // We use a non-greedy capture that stops at the first matching closing brace.
  const catchRe = /catch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = catchRe.exec(f.contents)) !== null) {
    const errName = m[1] ?? 'err';
    const body = m[2] ?? '';
    const trimmed = body.trim();
    if (trimmed.length === 0) {
      const lineNo = f.contents.slice(0, m.index).split('\n').length;
      issues.push({
        check: 'try_catch_logs_error',
        severity: 'warn',
        file: f.path,
        line: lineNo,
        message:
          `Empty catch block for "${errName}" — the error is silently swallowed. Add req.log.error({err:${errName}}) or rethrow.`,
      });
      continue;
    }
    const hasLog = /\b(?:log|logger|pino|console)\b.*\b(?:error|warn|info|debug)\b/i.test(body) ||
                   /\b(?:req|reply|app)\.\w*log\b/.test(body);
    const hasRethrow = new RegExp(`\\bthrow\\s+(?:${errName}|new\\s+\\w+|\\w+)`).test(body);
    const hasReplyError = /\breply\.(?:code\s*\(\s*[45]\d\d\s*\)\s*\.\s*)?send\s*\(/.test(body);
    if (!hasLog && !hasRethrow && !hasReplyError) {
      const lineNo = f.contents.slice(0, m.index).split('\n').length;
      issues.push({
        check: 'try_catch_logs_error',
        severity: 'warn',
        file: f.path,
        line: lineNo,
        message:
          `catch (${errName}) {...} body neither logs, rethrows, nor sends an error reply. ` +
          `Errors silently disappear; add req.log.error({err:${errName}}) or rethrow so operators see incidents.`,
      });
    }
  }
  return issues;
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
