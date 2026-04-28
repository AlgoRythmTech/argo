# Using Neon (Free Cloud Postgres) Instead of Docker

If Docker Postgres keeps failing with P1000 auth errors, use Neon — a free cloud Postgres that works instantly.

## Steps

1. Go to https://neon.tech and sign up (free, no credit card)

2. Create a new project called "argo"

3. Copy the connection string — it looks like:
   ```
   postgresql://neondb_owner:PASSWORD@ep-XXXX.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

4. Open your `.env.local` and replace BOTH lines:
   ```
   DATABASE_URL=postgresql://neondb_owner:PASSWORD@ep-XXXX.us-east-2.aws.neon.tech/neondb?sslmode=require
   DIRECT_URL=postgresql://neondb_owner:PASSWORD@ep-XXXX.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

5. Run migrations:
   ```powershell
   cd apps\api
   pnpm exec dotenv -e ../../.env.local -- pnpm exec prisma migrate dev
   ```

6. Start the API:
   ```powershell
   cd C:\Users\aasri\server-backend
   pnpm --filter @argo/api dev
   ```

Done. No Docker needed for Postgres. MongoDB and Redis still run in Docker.

## Why This Works

Neon's free tier gives you:
- 10 GB storage
- 100 hours of compute per month
- Auto-suspend when idle (saves compute)
- SSL by default
- No auth issues — the connection string includes the password
