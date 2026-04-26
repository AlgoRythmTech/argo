# Argo — AI Business Operator

> Describe the workflow once. Argo runs it. Reply to email when it asks.

Argo operates the business workflows of solo service operators (recruiters,
consultants, property managers, coaches). It is **not** an app builder. It is
the operating layer that runs the app forever, with email as the only control
surface the customer ever needs.

## Quick start

```bash
# 1. Copy env template and fill in real keys (rotated, never committed)
cp .env.example .env.local

# 2. Install dependencies
pnpm install

# 3. Bring up dev infrastructure (postgres + mongo + redis + mailpit)
pnpm infra:up

# 4. Generate Prisma client and run migrations
pnpm db:generate
pnpm db:migrate

# 5. Run web + api in parallel
pnpm dev
```

Then:

| Surface         | URL                       |
| --------------- | ------------------------- |
| Web (Vite)      | http://localhost:5173     |
| API (Fastify)   | http://localhost:4000     |
| API health      | http://localhost:4000/health |
| Mailpit UI      | http://localhost:8025     |
| Postgres        | postgresql://argo:argo@localhost:5432/argo |
| MongoDB         | mongodb://argo:argo@localhost:27017/argo   |
| Redis           | redis://localhost:6379    |

## Monorepo layout

```
argo/
├── apps/
│   ├── web/                       React 18 + Vite + TS dashboard
│   └── api/                       Fastify + Prisma + BullMQ
├── packages/
│   ├── shared-types/              Zod schemas (single source of truth)
│   ├── security/                  Escape, PII redaction, allow-list, rate limiters
│   ├── workspace-runtime/         IExecutionProvider + Blaxel + Docker mock
│   ├── email-automation/          EmailAutomationService + AgentMail + Mailpit
│   ├── agent/                     State machine, context envelope, LLM router
│   └── build-engine/              Code generator (Open Lovable inspired)
├── infra/
│   └── docker/                    docker-compose.dev.yml + mongo init
├── docs/
│   ├── ARCHITECTURE.md
│   ├── EMAIL_DOCTRINE.md
│   ├── SECURITY.md
│   ├── RUNBOOK.md
│   └── BLOCKERS.md
└── licenses/                      Upstream license files (Apache-2.0, MIT)
```

## The locked stack

| Layer        | Choice                                       |
| ------------ | -------------------------------------------- |
| Execution    | **Blaxel** (one operation per environment)   |
| Email        | **AgentMail** (inbound + outbound)           |
| Build engine | Open Lovable fork (Apache-2.0)               |
| Test sandbox | E2B                                          |
| LLM (agent)  | OpenAI gpt-5.5 (primary), Claude (build)     |
| Backend      | Node 20 + TS + Fastify + Prisma + BullMQ     |
| DB (rel)     | Postgres 16                                   |
| DB (gen code)| MongoDB 7                                    |
| Cache/queue  | Redis 7                                      |
| Frontend     | React 18 + Vite + TS + Tailwind + React Flow |
| Auth         | Magic link only (no passwords, ever)         |

## The doctrine

1. **Maya is the customer.** Every feature must make her Monday morning shorter.
2. **Email is the interface.** The dashboard exists for setup and monthly check-in. Nothing else.
3. **Trust ratchet is hard-coded.** First 10 sends per template require approval; opt-in unlocks at 95% approval rate.
4. **The agent is not the runtime.** Agents generate and repair; deterministic code runs.
5. **Security defaults are constants, not toggles.** RLS on, secrets in env, signatures verified, output escaped, packages allow-listed.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full system map.

## Phase status

| Phase | Description                  | Status |
| ----- | ---------------------------- | ------ |
| 0     | Customer development         | DEFERRED (founder override; see [docs/PIVOT.md](docs/PIVOT.md)) |
| 1     | Manual operations            | DEFERRED (founder override) |
| 2     | Bootstrap & auth             | DONE — magic link + dashboard shell + React Flow |
| 3     | Workflow builder & agent core| DONE — three-question dialogue + Zod-validated map + WS updates |
| 4     | Build, test, deploy          | DONE — generator + validator + IExecutionProvider deploy + live URL |
| 5     | Email automation             | DONE — locked templates + token approvals + AgentMail/Mailpit |
| 6     | Self-healing                 | DONE — observability sidecar + repair worker + trust ratchet |
| 7     | Polish & demo day readiness  | PENDING — landing copy + 60s video + third-party security audit |
| 8     | Scale to 30                  | PENDING — referral loop + Indie Hackers essay |

## Documentation

- [docs/PIVOT.md](docs/PIVOT.md) — build-time decisions and overrides
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system map
- [docs/SECURITY.md](docs/SECURITY.md) — security defaults
- [docs/EMAIL_DOCTRINE.md](docs/EMAIL_DOCTRINE.md) — Section 8 codified
- [docs/RUNBOOK.md](docs/RUNBOOK.md) — local dev walkthrough
- [docs/BLOCKERS.md](docs/BLOCKERS.md) — known unknowns
- [docs/UPSTREAM.md](docs/UPSTREAM.md) — what we cloned and what we borrowed

## License

Argo source is © AlgoRythmTech. Forked components retain their upstream
licenses; see `/licenses/` for the canonical files.

## Attribution

Argo's BUILDING-phase code generator stands on the shoulders of the open-source
vibe-coding community — most directly Open Lovable (Apache-2.0). Patterns for
human-in-the-loop approvals borrow from Cline (Apache-2.0). Prior art for the
agent event taxonomy comes from OpenHands (MIT).
