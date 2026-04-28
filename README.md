# Argo — Never Ship Broken Workflows

> The first AI that refuses to ship changes that break what already works.

Argo runs business workflows end-to-end for non-technical operators. Describe your workflow in one sentence, answer 3 click-through questions, and get a live URL in 90 seconds. Every change passes 49 quality checks, 15 security scans, auto-generated regression tests, and human approval gates before it touches your customers.

**One-liner for YC:** Argo runs candidate intake for recruiting agencies end-to-end and refuses to ship changes that break what already works.

## What makes Argo different

| | Replit | Lovable | Emergent | **Argo** |
|---|---|---|---|---|
| Target user | Developers | Non-tech founders | Founders | **Non-tech business operators** |
| Core promise | AI pair programmer | Text-to-UI | Full-stack vibe coding | **Never-ship-broken workflows** |
| Regression testing | No | No | No | **Auto-generated, runs before every deploy** |
| Security scanning | No | No | No | **15 categories, every deploy** |
| Quality gate | No | No | No | **49 checks, every deploy** |
| Human approval gates | No | No | No | **Built-in, email-based** |
| Self-healing | No | No | No | **Detects errors, proposes fix, waits for approval** |
| Iterate without regression | No | No | No | **Baseline tests before every change** |
| Agent builder | No | No | No | **OpenClaw-based, deploy to sandboxes** |

## Quick start

### Docker (recommended)

```bash
cp .env.example .env.local                # add your API keys
docker compose up -d                       # postgres + mongo + redis + mailpit + api
docker compose exec api pnpm db:deploy     # run migrations
pnpm install && pnpm dev                   # web on :5173, api on :4000
```

### Native dev stack

```bash
cp .env.example .env.local
pnpm install
pnpm infra:up          # postgres + mongo + redis + mailpit
pnpm db:generate && pnpm db:migrate
pnpm dev               # parallel web + api
```

| Surface | URL |
|---------|-----|
| Web (Vite) | http://localhost:5173 |
| API (Fastify) | http://localhost:4000 |
| Mailpit UI | http://localhost:8025 |

## Architecture

```
argo/
├── apps/
│   ├── web/                  React 18 + Vite + Tailwind (32 components, 5 pages)
│   └── api/                  Fastify + Prisma + BullMQ (29 API routes)
├── packages/
│   ├── agent/                LLM router + OpenClaw skills + tools (OpenAI/Anthropic)
│   ├── build-engine/         Code generation + quality gate + security scanner
│   ├── workspace-runtime/    Blaxel sandbox deployment + Docker mock
│   ├── email-automation/     AgentMail + Mailpit + inbound parsing
│   ├── security/             Rate limiting + trust ratchet + PII redaction
│   └── shared-types/         Zod schemas (single source of truth)
└── infra/                    Docker Compose + Mongo init
```

### The Build Pipeline (7 stages)

```
Stream → Parse → Quality Gate (49 checks) → NPM Validate → Security Scan (15 categories)
  → Test Suite (auto-generated) → Deploy (Blaxel sandbox)
```

Every stage must pass. If any stage fails, the deploy is blocked. No exceptions.

When a stage fails, the **dynamic re-planning engine** (inspired by Devin v3) analyzes WHY it failed and tells GPT-5.5 specifically what to do differently — not just "fix the errors." This is why Argo converges where Lovable and Emergent loop forever on the same bug.

### Agent Builder + Sandbox Allocation

Argo includes a visual agent builder powered by OpenClaw skills:

- **PicoClaw mode** (<10 MB RAM): Stateless agents like email classifiers, lead qualifiers
- **Full agent mode** (2-4 GB RAM): Multi-step agents with database, web, and approval tools
- **Free tier**: 2 GB RAM per agent in shared 4 GB sandbox (2 agents per sandbox)
- **Paid tier**: Dedicated 4 GB sandbox per agent

Agents deploy to Blaxel sandboxes with:
- Auto-generated SKILL.md (OpenClaw format)
- Runtime harness with health monitoring
- Webhook/cron/form triggers
- LLM routing (GPT-5.5 / Claude Opus / Claude Sonnet)

### Key Features

**For Operators (non-technical)**
- Studio: conversational builder (type one sentence → click 3 options → live app)
- Live form preview: real interactive forms, not mockups
- Conversational iteration: "Make the rejection email warmer" → safety checks → approve
- ROI dashboard: hours saved, cost savings, response time improvements
- Email-based operation: approve/reject from your inbox, never open the dashboard

**For Trust (the moat)**
- 49-check quality gate before every deploy
- 15-category security scanner
- Auto-generated regression tests
- Human approval gates for customer-facing actions
- Self-healing: detects errors → diagnoses → proposes fix → waits for approval
- Iterate without regression: baseline tests before every change

**For Developers (if they look)**
- Full code viewer with syntax highlighting and bundle search
- Diff viewer between any two versions
- Pipeline visualization (7 stages, animated)
- Agent invocation replay with PII-redacted envelopes
- Guardrails dashboard (safety score, test results, scan findings)

## The Stack

| Layer | Choice |
|-------|--------|
| Execution | Blaxel sandboxes (per-operation isolation) |
| Email | AgentMail (production) / Mailpit (dev) |
| Build engine | Open Lovable fork (Apache-2.0) |
| Agent framework | OpenClaw skills + PicoClaw lightweight mode |
| LLM | GPT-5.5 (primary), Claude Opus 4.7 (build), Claude Sonnet 4.6 (fast) |
| Backend | Node 20 + TypeScript + Fastify + Prisma + BullMQ |
| Database | Postgres 16 (metadata) + MongoDB 7 (bundles, invocations) |
| Cache/Queue | Redis 7 (rate limits, BullMQ, Socket.io adapter) |
| Frontend | React 18 + Vite + Tailwind + Framer Motion |
| Auth | Magic link only (no passwords) |

## API Routes (29)

**Core**: health, auth (magic-link, session), operations (CRUD)
**Builder**: builder (start, submit-answers), scoping (workflow map editor)
**Deploy**: deploy (7-stage pipeline), build-stream (real-time progress)
**Safety**: guardrails (safety score, scans, tests), pipeline (stage status)
**Agents**: agent-builder (CRUD, templates, test, deploy), pool-stats
**Analytics**: analytics (overview, per-operation), roi (hours saved, cost savings)
**Studio**: detect (workflow type), build (from answers), simulate (test submission)
**Operations**: iterate (with regression), rollback, env-vars, logs, webhooks
**User**: notifications, memory, chat, billing, templates, status-page, replay

## Tests

```bash
pnpm test    # 259 tests across 6 packages, all passing
```

| Package | Tests |
|---------|-------|
| @argo/agent | 135 |
| @argo/build-engine | 87 |
| @argo/security | 21 |
| apps/api | 21 |
| @argo/shared-types | 3 |
| @argo/email-automation | 4 |

## Numbers

| Metric | Count |
|--------|-------|
| Source files | 286 |
| API routes | 33 |
| Web components | 32 |
| Web pages | 5 |
| Templates | 10 |
| Quality checks | 49 |
| Security scan categories | 15 |
| Agent tools | 15 |
| Agent templates | 6 |
| Tests passing | 271 |
| TypeScript errors | 0 |

## The Doctrine

1. **Maya is the customer.** Every feature must make her Monday morning shorter.
2. **Never ship broken.** 49 quality checks + 15 security scans + regression tests before every deploy.
3. **Email is the interface.** The dashboard exists for setup. Everything else happens from email.
4. **Trust ratchet is non-negotiable.** First 10 sends per template require approval; unlocks at 95%.
5. **The agent is not the runtime.** Agents generate and repair; deterministic code runs.
6. **Iterate without regression.** Baseline tests before every change, block if anything breaks.

## License

Argo source is (c) AlgoRythmTech. Forked components retain their upstream licenses (see `/licenses/`).

## Attribution

Built on: Open Lovable (Apache-2.0), OpenClaw (MIT), Cline (Apache-2.0), OpenHands (MIT).
