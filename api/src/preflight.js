import {pool} from './db.js';
import {config} from './config.js';
try{
  const {rows:[role]}=await pool.query('select current_user,rolsuper,rolbypassrls from pg_roles where rolname=current_user');
  if(role.rolsuper||role.rolbypassrls)throw new Error('The API role must not be superuser or bypass RLS');
  await pool.query('select request_key from checkout_requests limit 0');
  await pool.query('select app_session_valid($1,$2)',['00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000']);
  if(config.NODE_ENV==='production'&&!config.MFA_ENCRYPTION_KEY)throw new Error('Set MFA_ENCRYPTION_KEY before starting production');
  console.log('Database reachable; runtime role restricted; reliability and authentication schema present.');
  console.log(`API binding ${config.HOST}:${config.PORT}; connection limit ${config.DB_POOL_MAX}.`);
  if(!config.SMTP_URL||!config.MAIL_FROM)console.log('Password recovery email still needs configuration.');
}catch(error){console.error(`Preflight failed: ${error.message}`);process.exitCode=1;}
finally{await pool.end();}
