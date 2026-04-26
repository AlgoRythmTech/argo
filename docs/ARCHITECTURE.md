# Argo — Architecture

```
[User describes workflow]
        ↓
[Argo agent (LISTENING + MAPPING)]
        ↓
[Build engine — Open Lovable + Dyad patterns, GPT-5.5 / Claude Opus 4.7]
        ↓
[E2B / in-process sandbox — synthetic submissions]
        ↓
[Blaxel — runs the operation forever, hosts the public form URL]
        ↓
[AgentMail — inbound + outbound email; the only customer-facing surface]
```

## Process layout

| Surface                   | Process                              | Where it lives          |
| ------------------------- | ------------------------------------ | ----------------------- |
| Marketing + dashboard     | React 18 + Vite + Tailwind           | `apps/web`              |
| Control-plane API         | Fastify + Prisma + BullMQ            | `apps/api`              |
| LLM router + agent states | TypeScript, no daemon                | `packages/agent`        |
| Code generator            | TypeScript, deterministic            | `packages/build-engine` |
| Execution provider iface  | Blaxel / Docker mock                 | `packages/workspace-runtime` |
| Email plane               | AgentMail / Mailpit                  | `packages/email-automation`  |
| Security primitives       | escape, PII, allow-list, ratchet     | `packages/security`     |
| Schema source of truth    | Zod                                  | `packages/shared-types` |

## Data layout

| Concern                        | Store        | Notes                          |
| ------------------------------ | ------------ | ------------------------------ |
| Users / sessions / magic links | Postgres     | Prisma                         |
| Operations metadata            | Postgres     | + template counters            |
| Workflow maps + versions       | MongoDB      | append-only by version         |
| Generated bundles              | MongoDB      | manifest + file summaries      |
| Agent invocations + envelopes  | MongoDB      | replayable, PII-redacted       |
| Runtime events                 | MongoDB      | feeds the repair worker        |
| Operation repairs              | MongoDB      | append-only compliance log     |
| Activity feed                  | MongoDB      | bounded, last-1000-per-owner   |
| Job queues                     | Redis        | digest, repair, inbound, email |
| Realtime fanout                | Redis pub/sub| Socket.io adapter              |

## State machine

```
LISTENING → MAPPING → BUILDING → TESTING → RUNNING
                                   ↑__________|
                             repair loop, max 3 cycles
```

The agent is **not** a continuously running process. RUNNING is the
dormant state — the deterministic runtime executes the WorkflowMap step
by step. The agent re-enters only on three triggers:

1. Inbound webhook from AgentMail (a reply Maya wrote).
2. Runtime-event threshold crossed (5xx burst, unhandled exception, memory).
3. Monday-09:00 digest cron firing in Maya's timezone.

Read `/docs/PIVOT.md` for build-time decisions and overrides.
