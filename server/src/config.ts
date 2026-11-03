import { join } from 'node:path';

export interface Config {
  env: string;
  port: number;
  host: string;
  dbPath: string;
  jwtSecret: string;
  sessionHours: number;
  businessName: string;
  secureCookies: boolean;
  trustProxy: boolean;
  webDist?: string;
}

/**
 * Configuration from environment variables. JWT_SECRET is required in production;
 * in development a random secret is generated per process (sessions reset on restart).
 */
export function loadConfig(env = process.env): Config {
  const production = env.NODE_ENV === 'production';
  let jwtSecret = env.JWT_SECRET ?? '';
  if (!jwtSecret) {
    if (production) throw new Error('JWT_SECRET must be set in production (at least 32 random characters).');
    jwtSecret = crypto.randomUUID() + crypto.randomUUID();
  }
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters.');
  return {
    env: env.NODE_ENV ?? 'development',
    port: Number(env.PORT) || 4000,
    host: env.HOST ?? '0.0.0.0',
    dbPath: env.DB_PATH ?? join(process.cwd(), 'data', 'inventory.db'),
    jwtSecret,
    sessionHours: Number(env.SESSION_HOURS) || 12,
    businessName: env.BUSINESS_NAME ?? 'Demo Supermarket',
    secureCookies: production,
    trustProxy: env.TRUST_PROXY === '1',
    webDist: env.WEB_DIST,
  };
}
