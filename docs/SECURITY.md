# Argo — Security defaults

> The customer never sees these and never thinks about them. That is exactly the point.

## Constants (no opt-out, no toggle)

| Default                                  | Where enforced                                     |
| ---------------------------------------- | -------------------------------------------------- |
| All secrets in env                       | `packages/build-engine/src/validators/secret-validator.ts` |
| Webhook signature verification           | `packages/security/src/signatures.ts`              |
| Input validation on every public route   | Zod schema generated from WorkflowMap              |
| Output escaping in every email           | `escapeForEmail()` in `packages/security/src/escape.ts` |
| Rate limits (60/min forms, 1000/min webhooks) | Fastify plugin in `apps/api/src/server.ts`    |
| PII redaction in logs                    | `redactPii()` and `redactPiiObject()`              |
| Package allow-list (~50 pkgs)            | `packages/security/src/allow-list.ts`              |
| Static analysis at test phase            | bundle-validator + Semgrep in CI                   |
| Trust ratchet on outbound third-party    | `packages/security/src/trust-ratchet.ts`           |
| Append-only operation_repairs log        | MongoDB collection — never delete a row            |
| Magic-link only auth (no passwords)      | `apps/api/src/auth/magic-link.ts`                  |
| HMAC-SHA256 approval tokens, sha256-hashed at rest | `packages/security/src/tokens.ts`        |

## What we deliberately don't do

- **No row-level security toggles in any UI surface.** RLS is on by default and
  invisible. The customer is not a database administrator.
- **No "trust this email" / "skip approval" override.** The trust ratchet
  is the product. After 10 sends and 95% approval, the gate becomes opt-in
  per template — never globally.
- **No customer-facing logs.** Replay is via the production database with
  proper auth, not via log scrape. PII never lands in logs unhashed.
- **No third-party email-provider fallback in v1.** If AgentMail is down,
  we degrade to the dev Mailpit container in dev or queue the message in
  prod — we do *not* fail-over to SendGrid. (Section 13.)
- **No regulated-industry workflows.** Healthcare, financial services, and
  legal are explicitly out of scope. Maya is not in healthcare.

## Operational drills

- **Quarterly secret rotation.** SESSION_SECRET, COOKIE_SECRET, INTERNAL_API_KEY,
  AGENTMAIL_INBOUND_WEBHOOK_SECRET, BLAXEL_API_KEY.
- **Per-build allow-list audit.** A new dependency in the allow-list
  requires manual review by a human, recorded in the package's commit message.
- **Repair audit.** Every repair appends a row to `operation_repairs`.
  Never delete rows; never overwrite columns. This is the company's most
  important compliance artifact.
