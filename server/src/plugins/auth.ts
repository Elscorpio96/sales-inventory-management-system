import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DB } from '../db/index.js';
import type { Config } from '../config.js';
import { AppError } from '../lib/errors.js';

export type Role = 'owner' | 'manager' | 'cashier';
export interface AuthUser { id: number; name: string; email: string; role: Role }

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: number; tv: number };
    user: AuthUser;
  }
}
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...roles: Role[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    issueSession: (reply: FastifyReply, user: { id: number; token_version: number }) => Promise<void>;
  }
}

export const COOKIE = 'sims_token';

/**
 * JWT in an HttpOnly, SameSite=Strict cookie. Every request re-checks the user in the
 * database, so deactivating a user or bumping token_version revokes access immediately.
 */
export default fp<{ db: DB; config: Config }>(async (app, { db, config }) => {
  await app.register(cookie);
  await app.register(jwt, {
    secret: config.jwtSecret,
    cookie: { cookieName: COOKIE, signed: false },
    sign: { expiresIn: `${config.sessionHours}h` },
  });

  const findUser = db.prepare<[number], AuthUser & { token_version: number; active: number }>(
    'SELECT id, name, email, role, token_version, active FROM users WHERE id = ?',
  );

  app.decorate('authenticate', async (req: FastifyRequest) => {
    let payload: { sub: number; tv: number };
    try {
      payload = await req.jwtVerify<{ sub: number; tv: number }>({ onlyCookie: true });
    } catch {
      throw new AppError(401, 'Please sign in', 'UNAUTHENTICATED');
    }
    const u = findUser.get(payload.sub);
    if (!u || !u.active || u.token_version !== payload.tv) throw new AppError(401, 'Session expired. Please sign in again.', 'UNAUTHENTICATED');
    req.user = { id: u.id, name: u.name, email: u.email, role: u.role };
  });

  app.decorate('requireRole', (...roles: Role[]) => async (req: FastifyRequest, reply: FastifyReply) => {
    await app.authenticate(req, reply);
    if (!roles.includes(req.user.role)) throw new AppError(403, 'You do not have permission to do that', 'FORBIDDEN');
  });

  app.decorate('issueSession', async (reply: FastifyReply, user: { id: number; token_version: number }) => {
    const token = await reply.jwtSign({ sub: user.id, tv: user.token_version });
    reply.setCookie(COOKIE, token, {
      httpOnly: true, sameSite: 'strict', secure: config.secureCookies, path: '/', maxAge: config.sessionHours * 3600,
    });
  });
});
