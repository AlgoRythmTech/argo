import IORedis from 'ioredis';
import { getConfig } from '../config.js';

let client: IORedis | null = null;

export function getRedis(): IORedis {
  if (client) return client;
  const cfg = getConfig();
  client = new IORedis(cfg.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  return client;
}
