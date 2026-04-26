import type { Server as HttpServer } from 'node:http';
import { Server as SocketIoServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { getRedis } from '../db/redis.js';
import { logger } from '../logger.js';
import { resolveSession } from '../auth/session.js';

let io: SocketIoServer | null = null;

export function attachSocketIo(httpServer: HttpServer, corsOrigins: string[]) {
  if (io) return io;
  io = new SocketIoServer(httpServer, {
    cors: { origin: corsOrigins, credentials: true },
    serveClient: false,
    transports: ['websocket', 'polling'],
  });

  const pub = getRedis().duplicate();
  const sub = getRedis().duplicate();
  io.adapter(createAdapter(pub, sub));

  io.use(async (socket, next) => {
    const cookieHeader = socket.handshake.headers.cookie ?? '';
    const sessionToken = parseCookie(cookieHeader, 'argo_session') ?? extractBearer(socket.handshake.auth?.token);
    const session = await resolveSession(sessionToken);
    if (!session) return next(new Error('unauthorized'));
    socket.data.userId = session.userId;
    await socket.join(`owner:${session.userId}`);
    next();
  });

  io.on('connection', (socket) => {
    logger.debug({ userId: socket.data.userId }, 'socket connected');
    socket.on('disconnect', (reason) => {
      logger.debug({ userId: socket.data.userId, reason }, 'socket disconnected');
    });
  });

  return io;
}

export function broadcastToOwner(ownerId: string, payload: unknown) {
  if (!io) return;
  io.to(`owner:${ownerId}`).emit('event', payload);
}

function parseCookie(header: string, name: string): string | undefined {
  const parts = header.split(';');
  for (const p of parts) {
    const [k, v] = p.split('=');
    if (k && v && k.trim() === name) return decodeURIComponent(v.trim());
  }
  return undefined;
}

function extractBearer(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.startsWith('Bearer ') ? value.slice(7) : value;
}
