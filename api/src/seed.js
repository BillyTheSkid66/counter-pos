import { Client } from './postgres.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
if(config.NODE_ENV==='production')throw new Error('Showcase seeding is disabled in production; use an isolated demonstration database');
const client = new Client({ connectionString: config.ADMIN_DATABASE_URL ?? config.DATABASE_URL });
await client.connect();
await client.query(await readFile(join(root, 'seeds', 'development.sql'), 'utf8'));
await client.query(await readFile(join(root, 'seeds', 'showcase.sql'), 'utf8'));
await client.end();
console.log('Development and showcase organisations seeded');
