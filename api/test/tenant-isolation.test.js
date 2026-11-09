import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
test('RLS prevents one organisation reading another organisation products', { skip: !url && 'TEST_DATABASE_URL not configured' }, async () => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const northOrg = '20000000-0000-0000-0000-000000000001';
  const northUser = '10000000-0000-0000-0000-000000000001';
  await client.query('begin');
  await client.query("select set_config('app.current_organisation_id',$1,true)",[northOrg]);
  await client.query("select set_config('app.current_user_id',$1,true)",[northUser]);
  const result = await client.query('select sku from products order by sku');
  await client.query('rollback');
  await client.end();
  assert.deepEqual(result.rows.map(x=>x.sku),['NORTH-001']);
  assert.equal(result.rows.some(x=>x.sku==='SOUTH-001'),false);
});

test('RLS hides product families belonging to other organisations', { skip: !url && 'TEST_DATABASE_URL not configured' }, async () => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('begin');
  await client.query("select set_config('app.current_organisation_id',$1,true)",['20000000-0000-0000-0000-000000000002']);
  const result = await client.query('select name from product_families');
  await client.query('rollback');
  await client.end();
  assert.equal(result.rows.some(row=>row.name==='ElfLiq Nic Salts'),false);
});
