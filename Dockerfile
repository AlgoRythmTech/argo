# ================================================================
# Argo API — production-ish image for the old-laptop demo.
#
# Stage 1: install ALL workspace deps + generate Prisma client.
# Stage 2: copy source + node_modules into a slim runtime image.
#
# This is intentionally a single-image build, NOT a multi-arch
# distroless build, because the goal is "operator can copy this repo
# to a laptop with Docker and `docker compose up`." Production hosting
# uses a different image (Blaxel-managed, see /docs/RUNBOOK.md).
# ================================================================

FROM node:20-alpine AS builder
WORKDIR /app

# pnpm via corepack so the lockfile is honoured.
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Copy the workspace skeleton first so dependency resolution caches.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/agent/package.json packages/agent/
COPY packages/build-engine/package.json packages/build-engine/
COPY packages/email-automation/package.json packages/email-automation/
COPY packages/security/package.json packages/security/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/workspace-runtime/package.json packages/workspace-runtime/

# Allow lockfile drift in container builds — apps/web is dev-only here
# and we won't run prisma in this stage, so a relaxed install is fine.
RUN pnpm install --frozen-lockfile=false

# Now copy everything else.
COPY . .

# Generate Prisma client. Schema lives in apps/api/prisma.
RUN pnpm --filter @argo/api db:generate

# ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

# Install pnpm + a couple of OS deps the runtime image actually
# uses (openssl is required by Prisma's query engine; tini gives us
# proper SIGTERM forwarding so the API drains in-flight requests).
RUN apk add --no-cache openssl tini && corepack enable && corepack prepare pnpm@9.12.0 --activate

# Bring across the entire built workspace from the builder stage.
COPY --from=builder /app /app

# Argo's standard env. Override at runtime via docker-compose.
ENV NODE_ENV=production \
    LOG_LEVEL=info \
    API_HOST=0.0.0.0 \
    API_PORT=4000

EXPOSE 4000

# tini reaps zombies + forwards signals; the API's own SIGTERM handler
# closes Fastify cleanly, drains BullMQ, and disconnects Mongo.
ENTRYPOINT ["/sbin/tini", "--"]

# Run the API in dev mode (tsx watch) so the user can rebuild without
# re-bundling the image. The compose file mounts the source directory
# so file changes show up live.
CMD ["pnpm", "--filter", "@argo/api", "dev"]
