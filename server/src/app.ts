import { existsSync } from 'node:fs';
import Fastify, { type FastifyError } from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fastifyStatic from '@fastify/static';
import {
  hasZodFastifySchemaValidationErrors, jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { DB } from './db/index.js';
import type { Config } from './config.js';
import auth from './plugins/auth.js';
import { routes } from './modules/routes.js';
import { AppError } from './lib/errors.js';

/** Build the Fastify app around an open database. Used by the server and by tests. */
export async function buildApp(db: DB, config: Config) {
  const app = Fastify({
    logger: config.env === 'test' ? false : { level: config.env === 'production' ? 'info' : 'debug', redact: ['req.headers.cookie'] },
    trustProxy: config.trustProxy,
    bodyLimit: 256 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Swagger UI and chart library inline styles
        imgSrc: ["'self'", 'data:'],
      },
    },
  });
  await app.register(rateLimit, { global: false });
  await app.register(swagger, {
    openapi: {
      info: { title: 'Sales & Inventory Management API', version: '1.0.0', description: 'All amounts are integers in kobo (₦1 = 100 kobo). Authentication is an HttpOnly cookie set by POST /api/auth/login.' },
      tags: ['auth', 'users', 'products', 'inventory', 'sales', 'reports'].map((name) => ({ name })),
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });
  await app.register(auth, { db, config });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Some fields are invalid',
        details: err.validation.map((v) => ({ field: v.instancePath.replace(/^\//, '').replace(/\//g, '.'), message: v.message })),
      });
    }
    if (err instanceof AppError) return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    if (err.statusCode === 429) return reply.code(429).send({ error: 'RATE_LIMITED', message: 'Too many attempts. Please wait and try again.' });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code ?? 'BAD_REQUEST', message: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'INTERNAL', message: 'Something went wrong' });
  });

  await app.register(routes, { prefix: '/api', db, config });
  app.get('/api/health', { schema: { hide: true } }, async () => ({ ok: true }));

  // Serve the built React app (single-page app fallback) when available
  if (config.webDist && existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/assets/') || req.method !== 'GET') {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Route not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
