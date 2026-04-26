import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { getConfig } from '../config.js';
import { consumeMagicLink, issueMagicLink } from '../auth/magic-link.js';
import { createSession, destroySession } from '../auth/session.js';
import { requireSession } from '../plugins/auth-plugin.js';

const RequestMagicLinkBody = z.object({
  email: z.string().email(),
});

const MagicCallbackQuery = z.object({
  token: z.string().min(20),
});

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post('/auth/magic-link', async (request, reply) => {
    const parsed = RequestMagicLinkBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    try {
      await issueMagicLink({ email: parsed.data.email });
      return reply.send({ ok: true, message: 'Check your inbox.' });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'email_domain_not_allowed') {
        return reply.code(403).send({ error: 'email_domain_not_allowed' });
      }
      throw err;
    }
  });

  app.get('/auth/magic-callback', async (request, reply) => {
    const parsed = MagicCallbackQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'missing_token' });

    const consumed = await consumeMagicLink(parsed.data.token);
    if (!consumed) {
      return reply.code(400).send({ error: 'invalid_or_expired_token' });
    }

    const { token } = await createSession({
      userId: consumed.userId,
      ipAddress: request.ip,
      userAgent: String(request.headers['user-agent'] ?? ''),
    });

    const cfg = getConfig();
    reply.setCookie('argo_session', token, {
      httpOnly: true,
      secure: cfg.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: cfg.AUTH_SESSION_TTL_DAYS * 24 * 60 * 60,
      signed: false,
    });

    const front = cfg.API_CORS_ORIGINS.split(',')[0]?.trim() ?? 'http://localhost:5173';
    return reply.redirect(`${front}/?auth=ok`);
  });

  app.post('/auth/logout', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    await destroySession(session.sessionId);
    reply.clearCookie('argo_session', { path: '/' });
    return reply.send({ ok: true });
  });

  app.get('/auth/me', async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    return reply.send({
      sessionId: session.sessionId,
      userId: session.userId,
      email: session.email,
      expiresAt: session.expiresAt.toISOString(),
    });
  });
}
