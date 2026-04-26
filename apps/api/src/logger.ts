import pino from 'pino';
import { getConfig } from './config.js';

const cfg = (() => {
  try {
    return getConfig();
  } catch {
    return null;
  }
})();

export const logger = pino({
  level: cfg?.LOG_LEVEL ?? process.env.LOG_LEVEL ?? 'info',
  base: { app: 'argo-api' },
  ...(cfg?.NODE_ENV !== 'production'
    ? { transport: { target: 'pino-pretty', options: { colorize: true, singleLine: true } } }
    : {}),
});
