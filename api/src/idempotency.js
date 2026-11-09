import {createHash} from 'node:crypto';

export async function once(client, organisationId, userId, key, payload, work) {
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key||'')) throw Object.assign(new Error('A valid Idempotency-Key is required'),{statusCode:400});
  const hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  // The row and its business effects commit together. Conflicting inserts wait
  // for that transaction, then read the original response instead of repeating it.
  await client.query(`insert into checkout_requests(organisation_id,request_key,user_id,payload_hash)
    values($1,$2,$3,$4) on conflict do nothing`,[organisationId,key,userId,hash]);
  const {rows:[row]}=await client.query('select * from checkout_requests where request_key=$1 for update',[key]);
  if(row.payload_hash!==hash) throw Object.assign(new Error('This checkout key was already used for a different request'),{statusCode:409});
  if(row.response) return row.response;
  const result=await work();
  await client.query('update checkout_requests set response=$1 where request_key=$2',[JSON.stringify(result),key]);
  return result;
}
