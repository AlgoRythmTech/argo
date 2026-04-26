import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { resolveSession, type SessionContext } from '../auth/session.js';

declare module 'fastify' {
  interface FastifyRequest {
    session?: SessionContext;
  }
}

export async function registerAuthPlugin(app: FastifyInstance) {
  app.addHook('preHandler', async (request: FastifyRequest) => {
    const cookieToken = (request as unknown as { cookies: Record<string, string | undefined> }).cookies?.argo_session;
    const headerToken = readBearer(request.headers.authorization);
    const token = cookieToken ?? headerToken;
    if (!token) return;
    const session = await resolveSession(token);
    if (session) {
      request.session = session;
    }
  });
}

export function requireSession(request: FastifyRequest, reply: FastifyReply): SessionContext | null {
  if (!request.session) {
    reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return request.session;
}

function readBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, value] = header.split(' ', 2);
  if (scheme?.toLowerCase() !== 'bearer' || !value) return undefined;
  return value;
}
