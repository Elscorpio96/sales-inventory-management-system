import { openDb } from '../src/db/index.js';
import { seed, DEMO_USERS } from '../src/db/seed.js';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';

export const config: Config = {
  env: 'test', port: 0, host: '127.0.0.1', dbPath: ':memory:', jwtSecret: 'test-secret-test-secret-test-secret-123',
  sessionHours: 1, businessName: 'Test Shop', secureCookies: false, trustProxy: false,
};

/** A fresh app over an in-memory database. `seeded: false` gives an empty catalogue with one owner. */
export async function setup({ seeded = true } = {}) {
  const db = openDb(':memory:');
  if (seeded) seed(db, { days: 5 });
  else {
    const bcrypt = (await import('bcryptjs')).default;
    db.prepare("INSERT INTO users (name, email, role, password_hash) VALUES ('Owner', ?, 'owner', ?)")
      .run(DEMO_USERS.owner.email, bcrypt.hashSync(DEMO_USERS.owner.password, 4));
  }
  const app = await buildApp(db, config);
  return { db, app };
}

type App = Awaited<ReturnType<typeof setup>>['app'];

/** Sign in and return a cookie header value. */
export async function login(app: App, who: keyof typeof DEMO_USERS) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: DEMO_USERS[who] });
  if (res.statusCode !== 200) throw new Error(`login ${who} failed: ${res.statusCode} ${res.body}`);
  const c = res.cookies.find((x) => x.name === 'sims_token')!;
  return `${c.name}=${c.value}`;
}
