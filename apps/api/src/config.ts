import { z } from 'zod';

/**
 * Centralised env loader. Boot fails fast if required vars are missing.
 *
 * Section 12: "All secrets in environment variables, validated at build
 * time. Hardcoded API keys cause the build to fail with a specific error
 * code."
 */

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  TZ: z.string().default('America/New_York'),

  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
  API_CORS_ORIGINS: z.string().default('http://localhost:5173'),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 chars'),
  COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET must be at least 32 chars'),
  INTERNAL_API_KEY: z.string().min(32, 'INTERNAL_API_KEY must be at least 32 chars'),

  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),
  MONGODB_URI: z.string().url(),
  MONGODB_DB: z.string().default('argo'),
  REDIS_URL: z.string().url(),

  AUTH_MAGIC_LINK_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  AUTH_SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  AUTH_ALLOWED_DOMAINS: z.string().default('*'),

  RATE_LIMIT_FORM_PER_MINUTE: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_WEBHOOK_PER_MINUTE: z.coerce.number().int().positive().default(1000),
  RATE_LIMIT_API_PER_MINUTE: z.coerce.number().int().positive().default(600),

  TRUST_RATCHET_MIN_APPROVALS: z.coerce.number().int().positive().default(10),
  TRUST_RATCHET_APPROVAL_RATE_THRESHOLD: z.coerce.number().min(0.5).max(1).default(0.95),

  REPAIR_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  REPAIR_MAX_CYCLES: z.coerce.number().int().positive().max(5).default(3),
  REPAIR_TRUST_FORCE_SMALL_CHANGE_FIRST: z.coerce.number().int().nonnegative().default(3),
});

export type ArgoConfig = z.infer<typeof schema>;

let cached: ArgoConfig | null = null;
export function getConfig(): ArgoConfig {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`ARGO_CONFIG_ERROR: invalid environment\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
