#!/usr/bin/env tsx
/**
 * Pre-flight port check — run before `docker compose up` to detect
 * port conflicts that cause cryptic P1000 errors.
 *
 * Usage: npx tsx scripts/check-ports.ts
 */

import { createConnection } from 'node:net';

const PORTS = [
  { port: 5433, service: 'PostgreSQL (Docker)', fix: 'Change ARGO_PG_PORT in .env.local or stop local Postgres' },
  { port: 27017, service: 'MongoDB (Docker)', fix: 'Stop local MongoDB: net stop MongoDB' },
  { port: 6379, service: 'Redis (Docker)', fix: 'Stop local Redis' },
  { port: 4000, service: 'Argo API', fix: 'Kill existing Argo process on port 4000' },
];

async function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    socket.setTimeout(1000);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => { socket.destroy(); resolve(false); });
  });
}

async function main() {
  console.log('Checking ports...\n');
  let hasConflict = false;

  for (const { port, service, fix } of PORTS) {
    const inUse = await checkPort(port);
    if (inUse) {
      console.log(`  [CONFLICT] Port ${port} (${service}) is already in use!`);
      console.log(`             Fix: ${fix}\n`);
      hasConflict = true;
    } else {
      console.log(`  [OK]       Port ${port} (${service}) is available`);
    }
  }

  if (hasConflict) {
    console.log('\nPort conflicts detected. Fix them before running docker compose up.\n');
    process.exit(1);
  } else {
    console.log('\nAll ports available. Safe to run: docker compose up -d\n');
  }
}

main().catch(console.error);
