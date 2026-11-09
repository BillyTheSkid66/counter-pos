import { Pool } from './postgres.js';
import { config } from './config.js';

export const pool = new Pool({ connectionString: config.DATABASE_URL, max: config.DB_POOL_MAX, idleTimeoutMillis: 30_000, connectionTimeoutMillis: config.DB_TIMEOUT_MS, statement_timeout: config.DB_TIMEOUT_MS });
pool.on('error', () => console.error('Idle database connection failed'));

export async function withTenant({ organisationId, userId, supportReadOnly=false }, work) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.current_organisation_id', $1, true)", [organisationId]);
    await client.query("select set_config('app.current_user_id', $1, true)", [userId]);
    const membership = supportReadOnly?{rowCount:1,rows:[{role:'support'}]}:await client.query(
      'select role from organisation_memberships where organisation_id = $1 and user_id = $2 and status = $3',
      [organisationId, userId, 'active']
    );
    if (!membership.rowCount) throw Object.assign(new Error('Organisation access denied'), { statusCode: 403 });
    const result = await work(client, membership.rows[0]);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
