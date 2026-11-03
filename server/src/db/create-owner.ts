/**
 * Create the first owner account for a real installation.
 *   OWNER_NAME="Jane Doe" OWNER_EMAIL=jane@shop.ng OWNER_PASSWORD='long-password' npm run create-owner -w server
 */
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { openDb } from './index.js';
import { loadConfig } from '../config.js';

const input = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email(),
  password: z.string().min(10, 'Password must be at least 10 characters'),
}).safeParse({ name: process.env.OWNER_NAME, email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });

if (!input.success) {
  console.error('Set OWNER_NAME, OWNER_EMAIL and OWNER_PASSWORD:\n  ' + input.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  '));
  process.exit(1);
}
const config = loadConfig({ ...process.env, JWT_SECRET: process.env.JWT_SECRET || 'x'.repeat(32) });
const db = openDb(config.dbPath);
try {
  db.prepare("INSERT INTO users (name, email, role, password_hash) VALUES (?, ?, 'owner', ?)")
    .run(input.data.name, input.data.email, bcrypt.hashSync(input.data.password, 10));
  console.log(`Owner ${input.data.email} created.`);
} catch (e) {
  console.error(String((e as { code?: string }).code).startsWith('SQLITE_CONSTRAINT') ? 'That email already exists.' : e);
  process.exit(1);
} finally {
  db.close();
}
