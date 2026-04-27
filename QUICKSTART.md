# Argo — Old-laptop quickstart

You have an old laptop with **Docker Desktop** installed. This guide gets the
full Argo stack running on it in ~10 minutes, using a single `docker compose up`
command. Then optionally points the **frontend dev server on a second laptop**
at it so you can demo from a sleek machine while the backend lives elsewhere.

The shipped image runs:
- Postgres 16 (operations metadata + sessions)
- MongoDB 7 (generated bundles + agent invocations + briefs)
- Redis 7 (BullMQ workers + rate limits + websocket adapter)
- Mailpit (local SMTP sink so magic-link sign-in works without an SMTP provider)
- Argo API (Fastify + tsx watch — picks up live edits)

---

## Phase 1 — Get it running on the old laptop

### Step 1: Clone the repo

```bash
cd ~/code
git clone https://github.com/AlgoRythmTech/argo.git
cd argo
```

### Step 2: Copy the env template

```bash
cp .env.example .env.local
```

### Step 3: Edit `.env.local`

Open `.env.local` and fill in **at minimum** these values. The first three are
required for the API to boot at all; the rest are optional but unlock features.

```ini
# REQUIRED — generate three random 64-hex strings.
# On Mac/Linux: openssl rand -hex 32
# On Windows PowerShell: -join ((48..57+97..102) | Get-Random -Count 64 | % {[char]$_})
SESSION_SECRET=<paste 64 hex chars>
COOKIE_SECRET=<paste 64 hex chars>
INTERNAL_API_KEY=<paste 64 hex chars>

# REQUIRED for code generation to actually run
OPENAI_API_KEY=sk-proj-...

# RECOMMENDED — fallback when GPT-5.5 access isn't available
OPENAI_MODEL_PRIMARY=gpt-5.5
OPENAI_MODEL_FALLBACK=gpt-4o
ANTHROPIC_API_KEY=sk-ant-...

# RECOMMENDED — real Blaxel sandbox + real preview URL.
# Without it, deploys fall back to the Docker mock provider (still works locally,
# just no public URL — preview URL becomes http://localhost:<random port>).
BLAXEL_ENABLED=true
BLAXEL_API_KEY=bl_...
BLAXEL_WORKSPACE=<your blaxel workspace name>

# OPTIONAL — agent fetches real components from 21st.dev mid-build
TWENTY_FIRST_API_KEY=<get from https://21st.dev/magic/console>

# OPTIONAL — persistent operator memory across builds
SUPERMEMORY_ENABLED=true
SUPERMEMORY_API_KEY=sm_...
```

The compose file overrides `DATABASE_URL`, `MONGODB_URI`, and `REDIS_URL` so
you don't need to set those — the API talks to the other services by hostname.

### Step 4: Bring up the stack

```bash
docker compose up -d
```

The first run pulls Postgres / Mongo / Redis / Mailpit images and builds the
API image (~3 min). Subsequent runs are 5-10 sec.

Watch it come up:
```bash
docker compose logs -f api
```

You're looking for `argo-api listening { port: 4000, env: 'production' }`.

### Step 5: Run the Prisma migration

The API container has Prisma but doesn't auto-migrate (so you can't accidentally
wipe data). Run migrations once after the first boot:

```bash
docker compose exec api pnpm --filter @argo/api db:deploy
```

### Step 6: Sanity-check

```bash
curl http://localhost:4000/health
# → {"status":"ok","uptime":<seconds>}
```

Open Mailpit's web UI: <http://localhost:8025> — magic-link sign-in emails will
land there.

### Step 7: Run the web (still on the old laptop)

The API is running in Docker; the web stays on the host so Vite HMR works:

```bash
pnpm install
pnpm --filter @argo/web dev
```

Open <http://localhost:5173>, click **Sign in**, enter any email. Check
Mailpit (<http://localhost:8025>), click the magic link, you land in the
workspace.

---

## Phase 2 — Use the old laptop as a remote backend (optional)

If you want the **frontend on a second laptop** while the **backend stays on
the old laptop**:

### Step 8: Find the old laptop's LAN IP

```bash
# Mac/Linux:
ifconfig | grep "inet " | grep -v 127.0.0.1
# Windows:
ipconfig | findstr IPv4
```

You're looking for something like `192.168.1.42`.

### Step 9: Open the API to the LAN

In the old laptop's `.env.local`:

```ini
API_PUBLIC_URL=http://192.168.1.42:4000
API_CORS_ORIGINS=http://localhost:5173,http://192.168.1.SECOND_LAPTOP_IP:5173
```

Restart just the API:
```bash
docker compose restart api
```

### Step 10: Point the second laptop's web at it

On the **second laptop**, in `argo/.env.local`:
```ini
VITE_API_URL=http://192.168.1.42:4000
```

Then on the second laptop:
```bash
pnpm --filter @argo/web dev
```

Open <http://localhost:5173> — you're now using the second laptop's UI talking
to the old laptop's backend.

---

## What to test once it's up

1. **Sign in** → empty workspace with 6 example cards + "Load demo workspace"
2. **Click "Load demo workspace"** → instant fully-populated demo operation.
   Every PreviewPane tab populates: Code (8 files), Diff, Replay (14
   invocations on the timeline), Memory, Inbox, About modal.
3. **Click an example card** → smart-naming kicks in, scoping questionnaire
   loads, refinement round runs if GPT-5.5 thinks it's needed, click Build.
4. **Watch BuildStream**: file-write tags appearing live, the **cycle pill**
   turning amber/green, the **auto-fix narrative** when cycle 2 kicks in,
   the **live cost meter** ticking, **`tool_called` chips** when the agent
   fetches from 21st.dev (only if `TWENTY_FIRST_API_KEY` is set), and the
   **`testing` event** when the runtime testing agent boots the bundle and
   exercises /health + /submissions.
5. **After Build completes**: `Code` tab shows 28+ files for fullstack
   briefs (the file tree sidebar shows the full count).
6. **Click Go Live**: the Blaxel deploy starts (or Docker mock if
   `BLAXEL_ENABLED=false`). Watch the deploy progress events. After ~90s,
   the **Preview tab shows a real iframe** of the deployed app.

---

## Troubleshooting

**API container won't start.**
Check `docker compose logs api`. The most common cause is a missing required
env var (`SESSION_SECRET`, `COOKIE_SECRET`, `INTERNAL_API_KEY`, or
`OPENAI_API_KEY`). The API logs the missing one explicitly on boot.

**Magic-link email never arrives.**
Open Mailpit at <http://localhost:8025> directly — every dev email is
captured there. If Mailpit is empty, the API didn't reach the SMTP server;
check `docker compose logs mailpit`.

**Build hangs at "Cycle 1 streaming…"**
Your `OPENAI_API_KEY` is missing or wrong. The streamer falls through to
gpt-4o on a 404 but if both models fail, the cycle reports
`cycle_complete · passed=false`.

**"Permission denied" on docker compose.**
On Linux, add yourself to the docker group: `sudo usermod -aG docker $USER`,
then log out and back in.

**Reset everything to a clean state.**
```bash
docker compose down -v
```
This wipes the data volumes too. The next `docker compose up` is a fresh
slate.

---

## Stopping cleanly

```bash
docker compose down       # stops containers, keeps data
docker compose down -v    # stops containers AND wipes data
```
