// This file MUST be loaded before server.ts via --import flag.
// It loads .env.local into process.env before any other module runs.
import { config } from 'dotenv';
import { resolve } from 'node:path';

// Try multiple locations — the API runs from apps/api/ but .env.local is at root.
config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '..', '..', '.env.local') });
config(); // fallback to .env
