// Deep security scanner for AI-generated code.
//
// CodeRabbit found AI code has 2.74x more security vulnerabilities than human
// code. This scanner goes beyond the quality gate's regex checks — it performs
// deeper analysis of data flow, auth patterns, and common vulnerability classes
// that LLMs consistently produce.
//
// The quality gate checks structural patterns ("does helmet exist?"). This
// scanner checks semantic patterns ("does user input reach a database query
// without validation?"). Together they catch what no other vibe coding tool does.

import type { OperationBundle, OperationBundleFile } from '@argo/workspace-runtime';

export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface SecurityFinding {
  severity: SecuritySeverity;
  category: string;
  file: string;
  line: number | null;
  title: string;
  description: string;
  recommendation: string;
  /** CWE ID when applicable (e.g. CWE-89 for SQL injection). */
  cwe: string | null;
}

export interface SecurityScanReport {
  passed: boolean;
  /** Total findings by severity. */
  counts: Record<SecuritySeverity, number>;
  findings: SecurityFinding[];
  /** Overall risk score (0-100, lower is better). */
  riskScore: number;
  scannedFiles: number;
  scanDurationMs: number;
}

/**
 * Run a deep security scan on a generated bundle.
 * Returns findings organized by severity. The quality gate should
 * still run separately — this is a complementary deep scan.
 */
export function runSecurityScan(bundle: OperationBundle): SecurityScanReport {
  const started = Date.now();
  const findings: SecurityFinding[] = [];

  const codeFiles = bundle.files.filter((f) =>
    /\.(m?js|tsx?|jsx?)$/.test(f.path) && !f.path.includes('node_modules'),
  );

  for (const file of codeFiles) {
    findings.push(...scanForInjection(file));
    findings.push(...scanForAuthBypass(file));
    findings.push(...scanForDataExposure(file));
    findings.push(...scanForInsecureConfig(file));
    findings.push(...scanForCryptoWeakness(file));
    findings.push(...scanForSSRF(file));
    findings.push(...scanForPrototypePollution(file));
    findings.push(...scanForReDoS(file));
    findings.push(...scanForHardcodedSecrets(file));
    findings.push(...scanForMissingRateLimit(file));
    findings.push(...scanForInsecureDeserialization(file));
    findings.push(...scanForLogInjection(file));
  }

  // Bundle-level checks.
  findings.push(...scanBundleForMissingAuthMiddleware(bundle));
  findings.push(...scanBundleForMissingCSRF(bundle));
  findings.push(...scanBundleForInsecureDeps(bundle));

  const counts: Record<SecuritySeverity, number> = {
    critical: 0, high: 0, medium: 0, low: 0, info: 0,
  };
  for (const f of findings) counts[f.severity]++;

  // Risk score: critical=25, high=10, medium=3, low=1, info=0. Cap at 100.
  const riskScore = Math.min(
    100,
    counts.critical * 25 + counts.high * 10 + counts.medium * 3 + counts.low * 1,
  );

  return {
    passed: counts.critical === 0 && counts.high === 0,
    counts,
    findings: findings.sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity)),
    riskScore,
    scannedFiles: codeFiles.length,
    scanDurationMs: Date.now() - started,
  };
}

function severityOrder(s: SecuritySeverity): number {
  return { critical: 0, high: 1, medium: 2, low: 3, info: 4 }[s];
}

function lineNumber(contents: string, charIndex: number): number {
  return contents.slice(0, charIndex).split('\n').length;
}

// ── Injection Detection ──────────────────────────────────────────────────

function scanForInjection(file: OperationBundleFile): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const c = file.contents;

  // NoSQL injection: dynamic property access on query objects.
  const nosqlPatterns = [
    /collection\([^)]*\)\.(find|findOne|updateOne|deleteOne|aggregate)\s*\(\s*\{[^}]*\$where/g,
    /\$where\s*:/g,
    /\.find\(\s*\{[^}]*\[.*request\b/gi,
    /\.find\(\s*JSON\.parse\s*\(/g,
  ];
  for (const re of nosqlPatterns) {
    let m;
    while ((m = re.exec(c)) !== null) {
      findings.push({
        severity: 'critical',
        category: 'nosql_injection',
        file: file.path,
        line: lineNumber(c, m.index),
        title: 'Potential NoSQL injection',
        description: 'Query constructed with dynamic user input. Attacker can inject $where or $gt/$ne operators.',
        recommendation: 'Always use Zod-validated input. Never pass raw request body/params into MongoDB queries.',
        cwe: 'CWE-943',
      });
    }
  }

  // Command injection via child_process.
  const cmdInjection = [
    /exec\s*\(\s*(`[^`]*\$\{|['"][^'"]*\+\s*(?:req|request|params|query|body))/gi,
    /spawn\s*\([^,]*(?:req|request|params|query|body)/gi,
    /execSync\s*\(/g,
  ];
  for (const re of cmdInjection) {
    let m;
    while ((m = re.exec(c)) !== null) {
      findings.push({
        severity: 'critical',
        category: 'command_injection',
        file: file.path,
        line: lineNumber(c, m.index),
        title: 'Potential command injection',
        description: 'User input flows into a shell command. This allows arbitrary command execution.',
        recommendation: 'Never pass user input to exec/spawn. Use allowlists and parameterized commands.',
        cwe: 'CWE-78',
      });
    }
  }

  // Template literal SQL/Mongo with user input.
  const templateInjection = /`[^`]*\$\{[^}]*(req\.|request\.|params\.|query\.|body\.)[^}]*\}[^`]*`/g;
  let tm;
  while ((tm = templateInjection.exec(c)) !== null) {
    // Skip if it's in a log statement.
    const before = c.slice(Math.max(0, tm.index - 40), tm.index);
    if (/log\.|console\.|logger\./i.test(before)) continue;
    findings.push({
      severity: 'high',
      category: 'template_injection',
      file: file.path,
      line: lineNumber(c, tm.index),
      title: 'User input in template literal',
      description: 'Request data interpolated directly into a string. If used in a query or command, this is an injection vector.',
      recommendation: 'Use parameterized queries or Zod validation before interpolation.',
      cwe: 'CWE-89',
    });
  }

  return findings;
}

// ── Auth Bypass Detection ────────────────────────────────────────────────

function scanForAuthBypass(file: OperationBundleFile): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const c = file.contents;

  // Routes that skip auth but access data.
  if (file.path.startsWith('routes/') || file.path.startsWith('src/routes/')) {
    const hasAuth = /requireSession|requireAuth|authenticate|preHandler.*auth/i.test(c);
    const hasDataAccess = /collection\(|prisma\.|\.findOne|\.find\(|\.insertOne|\.updateOne|\.deleteOne/i.test(c);
    const isPublic = /\/health|\/submissions|\/a\/|\/webhooks|\/internal/i.test(c);

    if (!hasAuth && hasDataAccess && !isPublic) {
      findings.push({
        severity: 'high',
        category: 'missing_auth',
        file: file.path,
        line: null,
        title: 'Route accesses data without authentication',
        description: 'This route queries or modifies data but has no authentication guard. Any unauthenticated user can access it.',
        recommendation: 'Add requireSession(request, reply) or a preHandler authentication hook.',
        cwe: 'CWE-306',
      });
    }
  }

  // JWT without verification.
  if (/jwt\.decode\(/i.test(c) && !/jwt\.verify\(/i.test(c)) {
    findings.push({
      severity: 'high',
      category: 'jwt_no_verify',
      file: file.path,
      line: null,
      title: 'JWT decoded without verification',
      description: 'jwt.decode() does not verify the signature. An attacker can forge tokens.',
      recommendation: 'Use jwt.verify() with a secret/public key instead of jwt.decode().',
      cwe: 'CWE-347',
    });
  }

  return findings;
}

// ── Data Exposure Detection ──────────────────────────────────────────────

function scanForDataExposure(file: OperationBundleFile): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const c = file.contents;

  // Returning raw database documents without projection.
  const rawReturn = /return\s+(?:await\s+)?(?:db|collection)\S*\.find(?:One)?\s*\([^)]*\)\s*(?:\.toArray\(\))?\s*;/g;
  let m;
  while ((m = rawReturn.exec(c)) !== null) {
    if (!/\.project\(|select:|\.map\(/i.test(c.slice(m.index, m.index + 200))) {
      findings.push({
        severity: 'medium',
        category: 'data_exposure',
        file: file.path,
        line: lineNumber(c, m.index),
        title: 'Raw database documents returned to client',
        description: 'Database query results returned without projection. Internal fields (_id, hashes, tokens) may leak.',
        recommendation: 'Use .project() or map() to return only the fields the client needs.',
        cwe: 'CWE-200',
      });
    }
  }

  // Logging sensitive fields.
  const sensitiveLog = /(?:log|console|logger)\.\w+\s*\([^)]*(?:password|secret|token|apiKey|api_key|authorization|cookie)[^)]*\)/gi;
  let sl;
  while ((sl = sensitiveLog.exec(c)) !== null) {
    findings.push({
      severity: 'medium',
      category: 'sensitive_logging',
      file: file.path,
      line: lineNumber(c, sl.index),
      title: 'Sensitive data in log output',
      description: 'A log statement references a sensitive field. This can expose secrets in log aggregation systems.',
      recommendation: 'Redact sensitive fields before logging. Use @argo/security redactPii().',
      cwe: 'CWE-532',
    });
  }

  return findings;
}

// ── Insecure Configuration ───────────────────────────────────────────────

function scanForInsecureConfig(file: OperationBundleFile): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const c = file.contents;

  // CORS wildcard.
  if (/origin\s*:\s*['"]\*['"]/i.test(c) || /origin\s*:\s*true\b/i.test(c)) {
    findings.push({
      severity: 'medium',
      category: 'open_cors',
      file: file.path,
      line: null,
      title: 'CORS allows all origins',
      description: 'Access-Control-Allow-Origin: * allows any website to make requests. Combined with credentials, this is a vulnerability.',
      recommendation: 'Set origin to specific allowed domains from environment config.',
      cwe: 'CWE-942',
    });
  }

  // Debug mode in production.
  if (/NODE_ENV.*development|debug\s*[:=]\s*true/i.test(c) && !c.includes('process.env.NODE_ENV')) {
    findings.push({
      severity: 'low',
      category: 'debug_in_prod',
      file: file.path,
      line: null,
      title: 'Debug mode may be enabled in production',
      description: 'Hardcoded debug/development settings. Use environment variables for environment-specific config.',
      recommendation: 'Check process.env.NODE_ENV instead of hardcoding.',
      cwe: 'CWE-489',
    });
  }

  return findings;
}

// ── Crypto Weakness ──────────────────────────────────────────────────────

function scanForCryptoWeakness(file: OperationBundleFile): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const c = file.contents;

  // Weak hashing algorithms.
  const weakHash = /createHash\s*\(\s*['"](?:md5|sha1)['"]/gi;
  let wh;
  while ((wh = weakHash.exec(c)) !== null) {
    findings.push({
      severity: 'high',
      category: 'weak_crypto',
      file: file.path,
      line: lineNumber(c, wh.index),
      title: 'Weak hash algorithm (MD5/SHA1)',
      description: 'MD5 and SHA1 are cryptographically broken. Collisions can be computed in seconds.',
      recommendation: 'Use SHA-256 or SHA-512 for hashing. Use bcrypt/argon2 for passwords.',
      cwe: 'CWE-328',
    });
  }

  // Math.random for security-sensitive operations.
  if (/Math\.random\s*\(\)/g.test(c)) {
    const context = c.toLowerCase();
    if (/token|secret|key|nonce|salt|session|auth|csrf/i.test(context)) {
      findings.push({
        severity: 'high',
        category: 'insecure_random',
        file: file.path,
        line: null,
        title: 'Math.random() used for security-sensitive value',
        description: 'Math.random() is not cryptographically secure. Tokens/secrets generated with it are predictable.',
        recommendation: 'Use crypto.randomBytes() or crypto.randomUUID() for security-sensitive values.',
        cwe: 'CWE-338',
      });
    }
  }

  return findings;
}

// ── SSRF Detection ───────────────────────────────────────────────────────

function scanForSSRF(file: OperationBundleFile): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const c = file.contents;

  // Fetching URLs constructed from user input.
  const ssrfPatterns = [
    /fetch\s*\(\s*(?:`[^`]*\$\{|['"][^'"]*\+\s*)(?:req|request|params|query|body)/gi,
    /request\s*\(\s*(?:`[^`]*\$\{|['"][^'"]*\+\s*)(?:req|request|params|query|body)/gi,
    /axios\.\w+\s*\(\s*(?:`[^`]*\$\{|['"][^'"]*\+\s*)(?:req|request|params|query|body)/gi,
  ];
  for (const re of ssrfPatterns) {
    let m;
    while ((m = re.exec(c)) !== null) {
      findings.push({
        severity: 'high',
        category: 'ssrf',
        file: file.path,
        line: lineNumber(c, m.index),
        title: 'Server-Side Request Forgery (SSRF)',
        description: 'User input used to construct a URL for server-side fetch. Attacker can reach internal services.',
        recommendation: 'Validate URLs against an allowlist. Block private IP ranges (10.x, 192.168.x, 127.x, 169.254.x).',
        cwe: 'CWE-918',
      });
    }
  }

  return findings;
}

// ── Prototype Pollution ──────────────────────────────────────────────────

function scanForPrototypePollution(file: OperationBundleFile): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const c = file.contents;

  // Object.assign with user input.
  const patterns = [
    /Object\.assign\s*\(\s*\{\s*\}\s*,\s*(?:req|request)\.body/gi,
    /\{\s*\.\.\.(?:req|request)\.body\s*\}/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(c)) !== null) {
      findings.push({
        severity: 'medium',
        category: 'prototype_pollution',
        file: file.path,
        line: lineNumber(c, m.index),
        title: 'Potential prototype pollution',
        description: 'Spreading/assigning raw request body into an object can allow __proto__ injection.',
        recommendation: 'Validate input with Zod first. Fastify strips __proto__ by default, but explicit validation is safer.',
        cwe: 'CWE-1321',
      });
    }
  }

  return findings;
}

// ── ReDoS Detection ──────────────────────────────────────────────────────

function scanForReDoS(file: OperationBundleFile): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const c = file.contents;

  // Common ReDoS patterns: nested quantifiers.
  const regexLiterals = /\/([^/\n]+)\/[gims]*/g;
  let rm;
  while ((rm = regexLiterals.exec(c)) !== null) {
    const pattern = rm[1]!;
    // Nested quantifiers like (a+)+ or (a*)*
    if (/(\(.+[+*]\))[+*]/.test(pattern) || /([+*])\1/.test(pattern)) {
      findings.push({
        severity: 'medium',
        category: 'redos',
        file: file.path,
        line: lineNumber(c, rm.index),
        title: 'Regular expression vulnerable to ReDoS',
        description: `Pattern contains nested quantifiers that can cause catastrophic backtracking: ${pattern.slice(0, 60)}`,
        recommendation: 'Simplify the regex or use a library with backtracking limits (e.g. RE2).',
        cwe: 'CWE-1333',
      });
    }
  }

  return findings;
}

// ── Hardcoded Secrets ────────────────────────────────────────────────────

function scanForHardcodedSecrets(file: OperationBundleFile): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const c = file.contents;

  const secretPatterns: Array<{ re: RegExp; name: string }> = [
    { re: /sk-proj-[A-Za-z0-9_-]{20,}/g, name: 'OpenAI API key' },
    { re: /sk-ant-[A-Za-z0-9_-]{20,}/g, name: 'Anthropic API key' },
    { re: /AKIA[0-9A-Z]{16}/g, name: 'AWS access key' },
    { re: /ghp_[A-Za-z0-9]{36}/g, name: 'GitHub personal token' },
    { re: /gho_[A-Za-z0-9]{36}/g, name: 'GitHub OAuth token' },
    { re: /xox[baprs]-[A-Za-z0-9-]+/g, name: 'Slack token' },
    { re: /sk_live_[A-Za-z0-9]{20,}/g, name: 'Stripe secret key' },
    { re: /rk_live_[A-Za-z0-9]{20,}/g, name: 'Stripe restricted key' },
    { re: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g, name: 'SendGrid API key' },
    { re: /mongodb\+srv:\/\/[^"'\s]+/g, name: 'MongoDB connection string' },
    { re: /postgres:\/\/[^"'\s]+/g, name: 'PostgreSQL connection string' },
  ];

  for (const { re, name } of secretPatterns) {
    let m;
    while ((m = re.exec(c)) !== null) {
      // Skip if it's in an env var reference or comment.
      const before = c.slice(Math.max(0, m.index - 50), m.index);
      if (/process\.env|\/\/|\/\*|\*\//i.test(before)) continue;

      findings.push({
        severity: 'critical',
        category: 'hardcoded_secret',
        file: file.path,
        line: lineNumber(c, m.index),
        title: `Hardcoded ${name}`,
        description: `A ${name} is hardcoded in source code. Anyone with access to the code can extract it.`,
        recommendation: 'Move to environment variables. Use process.env.KEY_NAME.',
        cwe: 'CWE-798',
      });
    }
  }

  return findings;
}

// ── Missing Rate Limit ───────────────────────────────────────────────────

function scanForMissingRateLimit(file: OperationBundleFile): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const c = file.contents;

  // POST routes without rate limiting.
  if (file.path.startsWith('routes/') || file.path.startsWith('src/routes/')) {
    const hasPost = /\.post\s*\(/g.test(c);
    const hasRateLimit = /rateLimit|rate_limit|rateLimiting|slowDown/i.test(c);
    const isInternal = /\/internal\//i.test(c);

    if (hasPost && !hasRateLimit && !isInternal) {
      findings.push({
        severity: 'medium',
        category: 'missing_rate_limit',
        file: file.path,
        line: null,
        title: 'POST route without rate limiting',
        description: 'Public POST endpoints without rate limiting are vulnerable to abuse and resource exhaustion.',
        recommendation: 'Add rate limiting via @fastify/rate-limit with per-IP limits.',
        cwe: 'CWE-770',
      });
    }
  }

  return findings;
}

// ── Insecure Deserialization ─────────────────────────────────────────────

function scanForInsecureDeserialization(file: OperationBundleFile): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const c = file.contents;

  // eval() or new Function() with user input.
  const dangerousEval = [
    /eval\s*\(\s*(?:req|request|params|query|body)/gi,
    /new\s+Function\s*\(\s*(?:req|request|params|query|body)/gi,
    /vm\.runInNewContext\s*\(/gi,
    /vm\.runInThisContext\s*\(/gi,
  ];
  for (const re of dangerousEval) {
    let m;
    while ((m = re.exec(c)) !== null) {
      findings.push({
        severity: 'critical',
        category: 'code_execution',
        file: file.path,
        line: lineNumber(c, m.index),
        title: 'Dynamic code execution with user input',
        description: 'eval/Function/vm with user input allows arbitrary code execution.',
        recommendation: 'Never use eval() or new Function() with user data. Use JSON.parse() for data, Zod for validation.',
        cwe: 'CWE-94',
      });
    }
  }

  return findings;
}

// ── Log Injection ────────────────────────────────────────────────────────

function scanForLogInjection(file: OperationBundleFile): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const c = file.contents;

  // Direct user input in log strings.
  const logInj = /(?:console|log|logger)\.\w+\s*\(\s*`[^`]*\$\{.*(?:req|request)\.(?:body|query|params)/gi;
  let m;
  while ((m = logInj.exec(c)) !== null) {
    findings.push({
      severity: 'low',
      category: 'log_injection',
      file: file.path,
      line: lineNumber(c, m.index),
      title: 'User input in log string',
      description: 'Unescaped user input in log output can enable log injection/forging attacks.',
      recommendation: 'Use structured logging (pino with object params) instead of string interpolation.',
      cwe: 'CWE-117',
    });
  }

  return findings;
}

// ── Bundle-Level Checks ──────────────────────────────────────────────────

function scanBundleForMissingAuthMiddleware(bundle: OperationBundle): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const serverFile = bundle.files.find(
    (f) => f.path === 'server.js' || f.path === 'src/server.js',
  );
  if (serverFile && !/helmet/i.test(serverFile.contents)) {
    findings.push({
      severity: 'high',
      category: 'missing_helmet',
      file: serverFile.path,
      line: null,
      title: 'Missing security headers (Helmet)',
      description: 'Helmet sets critical security headers (X-Content-Type-Options, X-Frame-Options, CSP, etc.).',
      recommendation: 'Add @fastify/helmet to the server bootstrap.',
      cwe: 'CWE-693',
    });
  }
  return findings;
}

function scanBundleForMissingCSRF(bundle: OperationBundle): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const hasCookie = bundle.files.some((f) => /cookie|session/i.test(f.contents));
  const hasCSRF = bundle.files.some((f) => /csrf|csrfToken|xsrf/i.test(f.contents));
  if (hasCookie && !hasCSRF) {
    findings.push({
      severity: 'medium',
      category: 'missing_csrf',
      file: '(bundle)',
      line: null,
      title: 'Cookie-based auth without CSRF protection',
      description: 'The app uses cookies but has no CSRF token mechanism. Attackers can forge authenticated requests.',
      recommendation: 'Add CSRF tokens to state-changing endpoints, or use SameSite=Strict cookies.',
      cwe: 'CWE-352',
    });
  }
  return findings;
}

function scanBundleForInsecureDeps(bundle: OperationBundle): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const pkgFile = bundle.files.find((f) => f.path === 'package.json');
  if (!pkgFile) return findings;

  try {
    const pkg = JSON.parse(pkgFile.contents) as {
      dependencies?: Record<string, string>;
    };
    const deps = pkg.dependencies ?? {};

    // Known risky patterns.
    const riskyDeps: Array<{ name: string; reason: string }> = [
      { name: 'request', reason: 'deprecated, use undici or node:fetch' },
      { name: 'express', reason: 'Argo bundles should use Fastify for consistency' },
      { name: 'body-parser', reason: 'built into Fastify — unnecessary dependency' },
      { name: 'querystring', reason: 'deprecated Node.js API — use URLSearchParams' },
      { name: 'node-fetch', reason: 'use undici (built-in) instead' },
    ];

    for (const { name, reason } of riskyDeps) {
      if (deps[name]) {
        findings.push({
          severity: 'low',
          category: 'risky_dependency',
          file: 'package.json',
          line: null,
          title: `Risky dependency: ${name}`,
          description: reason,
          recommendation: `Remove ${name} and use the recommended alternative.`,
          cwe: null,
        });
      }
    }
  } catch {
    // Invalid package.json — the quality gate will catch this.
  }

  return findings;
}

/**
 * Render a security scan report as markdown for the builder to consume
 * in the auto-fix loop. Only critical/high findings are included in the
 * re-prompt — medium/low are informational.
 */
export function renderSecurityReportAsAutoFixPrompt(report: SecurityScanReport): string {
  if (report.passed) return '';
  const blocking = report.findings.filter((f) => f.severity === 'critical' || f.severity === 'high');
  if (blocking.length === 0) return '';

  const lines: string[] = [];
  lines.push('# Security scan — BLOCKING findings');
  lines.push('');
  lines.push(`Risk score: ${report.riskScore}/100 (${blocking.length} critical/high findings)`);
  lines.push('');
  for (const f of blocking) {
    lines.push(`- [${f.severity.toUpperCase()}] ${f.file}${f.line ? `:${f.line}` : ''}: ${f.title}`);
    lines.push(`  ${f.description}`);
    lines.push(`  Fix: ${f.recommendation}`);
    lines.push('');
  }
  lines.push('Fix every critical/high finding. Re-emit only the affected files.');
  return lines.join('\n');
}
