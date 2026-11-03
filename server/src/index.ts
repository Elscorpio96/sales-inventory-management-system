import { join } from 'node:path';
import { loadConfig } from './config.js';
import { openDb } from './db/index.js';
import { buildApp } from './app.js';

const config = loadConfig();
config.webDist ??= join(process.cwd(), '..', 'web', 'dist');
const db = openDb(config.dbPath);
const app = await buildApp(db, config);

if ((db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n === 0) {
  app.log.warn('No users yet. Run `npm run seed` for demo data or `npm run create-owner -w server` for a real install.');
}

await app.listen({ port: config.port, host: config.host });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    db.close();
    process.exit(0);
  });
}
