// Copy non-TypeScript assets (SQL schema) into dist after tsc.
import { cpSync } from 'node:fs';
cpSync('src/db/schema.sql', 'dist/db/schema.sql');
