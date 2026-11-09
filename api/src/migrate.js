import { Client } from './postgres.js';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const client = new Client({ connectionString: config.ADMIN_DATABASE_URL ?? config.DATABASE_URL });
await client.connect();
try {
await client.query("select pg_advisory_lock(hashtext('counter:schema-migrations'))");
await client.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
for (const name of (await readdir(join(root, 'migrations'))).filter(x => x.endsWith('.sql')).sort()) {
  if ((await client.query('select 1 from schema_migrations where name=$1', [name])).rowCount) continue;
  const sql = await readFile(join(root, 'migrations', name), 'utf8');
  await client.query('begin');
  try { await client.query(sql); await client.query('insert into schema_migrations(name) values($1)', [name]); await client.query('commit'); console.log(`Applied ${name}`); }
  catch (error) { await client.query('rollback'); throw error; }
}
} finally { await client.end(); }
