# Runbook — local development

## Prerequisites

- Node 20.10+ (`node --version`)
- pnpm 9+ (`corepack enable && corepack prepare pnpm@9 --activate`)
- Docker Desktop (for postgres + mongo + redis + mailpit)

## Bootstrap

```bash
# 1. Copy the env template; fill in real keys (rotated, never committed).
cp .env.example .env.local

# 2. Install workspace dependencies.
pnpm install

# 3. Bring up infra (postgres, mongo, redis, mailpit).
pnpm infra:up

# 4. Generate Prisma client + run migrations.
pnpm db:generate
pnpm db:migrate
pnpm db:seed     # creates a Maya user for local testing

# 5. Run web + api.
pnpm dev
```

| Surface              | URL                                           |
| -------------------- | --------------------------------------------- |
| Web (Vite)           | http://localhost:5173                         |
| API (Fastify)        | http://localhost:4000                         |
| API health           | http://localhost:4000/health                  |
| Mailpit UI           | http://localhost:8025                         |
| Mongo                | mongodb://argo:argo@localhost:27017/argo      |
| Postgres             | postgresql://argo:argo@localhost:5432/argo    |
| Redis                | redis://localhost:6379                        |

## End-to-end smoke

1. Open http://localhost:5173 → click "Sign in →".
2. Enter `maya@example.com`.
3. Open Mailpit at http://localhost:8025 → click the magic-link email →
   tap "SIGN IN".
4. You're now in the Workspace. Type a workflow description in the
   prompt box: *"Candidates apply through a form on my website. I want to
   reject, screen, or forward each one."*
5. Argo asks three questions in sequence — answer each.
6. The workflow map is generated. Click **Go Live** in the top right.
7. The build engine generates the operation, the test sandbox validates
   it, and Blaxel (or the Docker mock) deploys it. The public URL appears
   in the header — click **Open** to see Maya's form.

## Useful commands

```bash
pnpm typecheck             # all packages, no emit
pnpm test                  # vitest across all packages
pnpm preflight             # typecheck + test + lint
pnpm db:studio             # Prisma Studio, GUI for the relational DB
pnpm infra:logs            # follow infra logs
pnpm infra:reset           # WIPES local data and re-creates volumes
```

## Production checklist (before first paying customer)

- [ ] Rotate every secret in `.env.example`. No defaults survive to prod.
- [ ] Set `BLAXEL_ENABLED=true` and verify `BLAXEL_API_KEY`, `BLAXEL_WORKSPACE`.
- [ ] Set `AGENTMAIL_ENABLED=true`, `AGENTMAIL_API_KEY`,
      `AGENTMAIL_INBOUND_WEBHOOK_SECRET`.
- [ ] Configure DNS for `*.argo-ops.run` to point to Blaxel ingress.
- [ ] Verify the inbound webhook URL is registered in AgentMail.
- [ ] Verify `/health` returns `{ status: "ok" }` for all subsystems.
- [ ] Run the third-party security audit (Section 7, Phase 7).
- [ ] Verify the trust ratchet defaults: 10 sends, 95% threshold.
- [ ] Verify Sentry DSN is set so production exceptions surface.
