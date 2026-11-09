import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const envPath=resolve('.env');
if(existsSync(envPath)){
  for(const rawLine of readFileSync(envPath,'utf8').split(/\r?\n/)){
    const line=rawLine.trim();
    if(!line||line.startsWith('#'))continue;
    const separator=line.indexOf('=');
    if(separator<1)continue;
    const key=line.slice(0,separator).trim();
    let value=line.slice(separator+1).trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
    if(process.env[key]===undefined)process.env[key]=value;
  }
}

if(process.env.NODE_ENV==='production'&&(process.env.RUN_MIGRATIONS==='true'||process.env.SEED_SHOWCASE==='true'))throw new Error('Run migrations explicitly before starting production. Showcase seeding must use a separate demonstration database.');
if(process.env.RUN_MIGRATIONS==='true')await import('./src/migrate.js');
if(process.env.SEED_SHOWCASE==='true')await import('./src/seed.js');
// Never retain migration-owner credentials in the long-running application.
delete process.env.ADMIN_DATABASE_URL;
await import('./src/server.js');
