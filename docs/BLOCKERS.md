# Blockers — known unknowns

If you advance past v0.1 without resolving these, things will break in
production. They are listed in priority order.

## B-001 — Blaxel API surface is documented but unverified end-to-end

The `BlaxelExecutionProvider` was written against the public docs from
`https://docs.blaxel.ai`. The exact wire format for `POST /v1/sandboxes`,
`PUT /v1/sandboxes/:id/files`, `POST /v1/sandboxes/:id/exec`, and
`GET /v1/sandboxes/:id/logs` may differ from what's deployed. Before the
first paying customer:

1. Run a `bl login algorythm` and use the CLI to push a hello-world.
2. Verify the same calls succeed via the SDK we use (`undici` POST).
3. Verify the public hostname template (`{operationId}.argo-ops.run`)
   actually resolves to the running sandbox.
4. If any of the above differ, update `packages/workspace-runtime/src/providers/blaxel.ts`
   accordingly and re-run the smoke test in `/docs/RUNBOOK.md`.

## B-002 — AgentMail webhook signature scheme

We assumed `X-AgentMail-Signature` (hex HMAC-SHA256 of `${ts}.${body}`)
matching the Stripe convention. Verify in AgentMail's docs. If it differs,
update `packages/email-automation/src/agentmail.ts#verifyInboundWebhook`.

## B-003 — Inbound parser eval corpus

The inbound parser (`packages/email-automation/src/inbound-parser.ts`)
uses deterministic-first heuristics with an LLM fallback. Section 8,
Doctrine 4 requires ≥200 anonymised real replies before going live.
Until we have that corpus, every inbound reply that doesn't match the
heuristics gets routed to a human in week one (per Section 10).

Create the eval harness at `apps/api/scripts/inbound-parser-eval.ts` once
the first ten customers have replied to enough Argo emails to build the
corpus.

## B-004 — Customer-development phases skipped

Phases 0 and 1 (5 customer interviews, 2-week manual operations pilot)
were skipped at founder request. The risk is documented in `/docs/PIVOT.md`.
If revenue does not materialise within 30 days of launch, return to
Phase 0 immediately.

## B-005 — Inbound parser LLM fallback uses GPT-5.5 model name

GPT-5.5 is configured as `OPENAI_MODEL_PRIMARY=gpt-5.5`. If OpenAI's
production endpoint reports the model differently (e.g. `gpt-5.5-turbo`
or `gpt-5.5-2026-01-01`), update `.env.local`. The router is generic over
the model name.

## B-006 — Repair worker contents reload from disk in dev

The repair worker (`apps/api/src/jobs/repair-worker.ts`) reconstructs
failing-file contents from `bundleDoc.filesSummary`, which only stores
sha256 + size. In production we need to re-fetch the actual contents from
the Blaxel sandbox via `executionProvider.execCommand({ command: 'cat <path>' })`
or the dedicated file API. This is a TODO marked in the worker body; the
fix is straightforward but requires Blaxel's exact file-read endpoint.

## B-007 — Operation_repairs table swap-deploy

After approval, the repair worker should call
`executionProvider.swapStagingToProduction()`. Currently the email-link
approval endpoint just marks the row `approved` — the swap is queued
separately. Wire the swap into `apps/api/src/routes/repairs.ts#approve`
once the staging-deploy lifecycle is verified.
