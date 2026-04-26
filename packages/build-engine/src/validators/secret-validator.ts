/**
 * Detects inlined secrets in generated code. The patterns below are
 * intentionally tight — false positives are preferable to false negatives.
 *
 * Section 12: "All secrets in environment variables, validated at build
 * time. Hardcoded API keys cause the build to fail with a specific error
 * code. The model is system-prompted to never inline a secret."
 */

const PATTERNS: Array<{ kind: string; regex: RegExp }> = [
  { kind: 'openai_key', regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { kind: 'anthropic_key', regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { kind: 'aws_access_key', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'aws_secret', regex: /\b[A-Za-z0-9/+=]{40}\b(?=.*aws.*secret)/gi },
  { kind: 'gcp_key', regex: /-----BEGIN PRIVATE KEY-----/ },
  { kind: 'github_pat', regex: /\bghp_[A-Za-z0-9]{30,}\b/g },
  { kind: 'github_oauth', regex: /\bgho_[A-Za-z0-9]{30,}\b/g },
  { kind: 'slack_bot', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: 'jwt', regex: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g },
  { kind: 'blaxel_key', regex: /\bbl_[A-Za-z0-9]{20,}\b/g },
];

export type SecretMatch = { kind: string; preview: string };

export function detectInlinedSecrets(source: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  for (const p of PATTERNS) {
    const m = source.match(p.regex);
    if (m) {
      for (const hit of m) {
        matches.push({ kind: p.kind, preview: hit.slice(0, 8) + '…' });
      }
    }
  }
  return matches;
}
