import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';

test('PostgreSQL API regressions',{skip:!process.env.INTEGRATION_DATABASE_URL},async t=>{
  assert.equal(process.env.NODE_ENV,'test');
  assert.match(new URL(process.env.INTEGRATION_DATABASE_URL).pathname,/_test$/,'Use an isolated *_test database');
  process.env.DATABASE_URL=process.env.INTEGRATION_DATABASE_URL;
  process.env.JWT_SECRET='integration-test-secret-with-more-than-32-characters';
  process.env.REQUIRE_ADMIN_MFA='false';
  process.env.MFA_ENCRYPTION_KEY='a'.repeat(64);
  const {app}=await import('../src/server.js');
  const {pool}=await import('../src/db.js');
  const admin=new pg.Client({connectionString:process.env.TEST_ADMIN_DATABASE_URL});await admin.connect();
  t.after(async()=>{await app.close();await pool.end();await admin.end()});
  const suffix=randomUUID().slice(0,8);
  const call=async(method,url,payload,session,key)=>{
    const result=await app.inject({method,url,...(payload==null?{}:{payload}),headers:{...(session?{authorization:`Bearer ${session.token}`,'x-organisation-id':session.organisation.id}:{}),...(key?{'idempotency-key':key}:{})}});
    return {status:result.statusCode,body:result.json()};
  };
  const trial=async(name)=>{const result=await call('POST','/api/public/trials',{businessName:name,ownerName:name,email:`${name}-${suffix}@test.example`,pin:'836194',planId:'pro',templateId:'blank'});assert.equal(result.status,200,JSON.stringify(result.body));return result.body;};
  const north=await trial('North'),south=await trial('South');
  assert.equal((await call('POST','/api/till-session/open',{openingFloat:100},north)).status,200);
  const created=await call('POST','/api/product-families',{name:'Test product',variants:[{sku:`SKU-${suffix}`,gtin:'1234567890123',options:{size:'one'},costPrice:1,retailPrice:12,stock:100}]},north);
  assert.equal(created.status,200,JSON.stringify(created.body));
  const {rows:[variant]}=await admin.query('select id from product_variants where sku=$1',[`SKU-${suffix}`]);
  const basket={items:[{variantId:variant.id,quantity:1}],paymentMethod:'cash'};
  let sale;
  await t.test('parallel checkout retries create one sale and decrement stock once',async()=>{
    const key=randomUUID(),results=await Promise.all([call('POST','/api/checkout',basket,north,key),call('POST','/api/checkout',basket,north,key)]);
    for(const result of results)assert.equal(result.status,200,JSON.stringify(result.body));
    assert.equal(results[0].body.saleId,results[1].body.saleId);sale=results[0].body;
    assert.equal(Number((await admin.query('select quantity from variant_stock_balances where variant_id=$1',[variant.id])).rows[0].quantity),99);
    assert.equal((await call('POST','/api/checkout',{...basket,paymentMethod:'card'},north,key)).status,409);
  });
  await t.test('full cash refund restores expected cash without double subtraction',async()=>{
    assert.equal((await call('GET','/api/till-session',null,north)).body.expectedCash,112);
    const result=await call('POST',`/api/transactions/${sale.saleId}/refund`,{managerPin:'836194',reason:'Test full refund'},north);
    assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.total,12);
    assert.equal((await call('GET','/api/till-session',null,north)).body.expectedCash,100);
  });
  await t.test('discounted lines, VAT, split refunds and duplicate return protection',async()=>{
    const families=(await call('GET','/api/product-families',null,north)).body;
    assert.equal((await call('POST','/api/promotions',{name:'Two for twenty',groupName:'Pair',familyIds:[families[0].id],quantity:2,bundlePrice:20},north)).status,200);
    const result=await call('POST','/api/checkout',{items:[{variantId:variant.id,quantity:2}],payments:[{method:'cash',amount:8},{method:'card',amount:12}]},north,randomUUID());
    assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.total,20);
    const receipt=(await call('GET',`/api/transactions/${result.body.saleId}`,null,north)).body;
    assert.equal(receipt.items[0].lineTotal,20);assert.equal(receipt.taxTotal,3.33);
    const item={saleItemId:receipt.items[0].id,quantity:1};
    assert.equal((await call('POST',`/api/transactions/${result.body.saleId}/return`,{items:[item,item],managerPin:'836194',reason:'Duplicate test'},north)).status,400);
    const refunded=await call('POST',`/api/transactions/${result.body.saleId}/return`,{items:[item],managerPin:'836194',reason:'One returned'},north);
    assert.equal(refunded.status,200,JSON.stringify(refunded.body));assert.equal(refunded.body.total,10);
    assert.equal(refunded.body.allocations.find(x=>x.method==='cash').amount,4);
    assert.equal(refunded.body.allocations.find(x=>x.method==='card').amount,6);
    assert.equal((await call('GET','/api/till-session',null,north)).body.expectedCash,104);
  });
  await t.test('tenant header substitution and RLS reject cross-business access',async()=>{
    const result=await app.inject({url:'/api/products',headers:{authorization:`Bearer ${north.token}`,'x-organisation-id':south.organisation.id}});assert.equal(result.statusCode,403);
    const client=await pool.connect();try{await client.query('begin');await client.query("select set_config('app.current_organisation_id',$1,true)",[south.organisation.id]);assert.equal((await client.query('select id from product_variants where id=$1',[variant.id])).rowCount,0);await client.query('rollback')}finally{client.release()}
  });
  await t.test('a rejected tender rolls stock, sale and checkout key back together',async()=>{
    const before=Number((await admin.query('select quantity from variant_stock_balances where variant_id=$1',[variant.id])).rows[0].quantity),key=randomUUID();
    const result=await call('POST','/api/checkout',{items:basket.items,payments:[{method:'cash',amount:1}]},north,key);
    assert.equal(result.status,422);
    assert.equal(Number((await admin.query('select quantity from variant_stock_balances where variant_id=$1',[variant.id])).rows[0].quantity),before);
    assert.equal((await admin.query('select 1 from checkout_requests where request_key=$1',[key])).rowCount,0);
  });
  await t.test('parallel sales cannot both sell the last unit',async()=>{
    await admin.query('update variant_stock_balances set quantity=1 where variant_id=$1',[variant.id]);
    const results=await Promise.all([call('POST','/api/checkout',basket,north,randomUUID()),call('POST','/api/checkout',basket,north,randomUUID())]);
    assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
    assert.equal(Number((await admin.query('select quantity from variant_stock_balances where variant_id=$1',[variant.id])).rows[0].quantity),0);
    await admin.query('update variant_stock_balances set quantity=100 where variant_id=$1',[variant.id]);
  });
  await t.test('store-credit issue, redemption and return preserve its balance',async()=>{
    const sale=(await call('POST','/api/checkout',basket,north,randomUUID())).body;
    const credit=await call('POST',`/api/transactions/${sale.saleId}/refund`,{managerPin:'836194',reason:'Exchange credit',refundMethod:'store_credit'},north);
    assert.equal(credit.status,200,JSON.stringify(credit.body));assert.ok(credit.body.creditCode);
    const spend=await call('POST','/api/checkout',{items:basket.items,payments:[{method:'store_credit',amount:12,referenceCode:credit.body.creditCode}]},north,randomUUID());
    assert.equal(spend.status,200,JSON.stringify(spend.body));
    assert.equal(Number((await admin.query('select balance from store_credits where code=$1',[credit.body.creditCode])).rows[0].balance),0);
    const returned=await call('POST',`/api/transactions/${spend.body.saleId}/refund`,{managerPin:'836194',reason:'Credit purchase returned'},north);assert.equal(returned.status,200,JSON.stringify(returned.body));
    assert.equal(Number((await admin.query('select balance from store_credits where code=$1',[credit.body.creditCode])).rows[0].balance),12);
  });
  await t.test('cash refund in a later till session leaves the closed session unchanged',async()=>{
    const sale=(await call('POST','/api/checkout',basket,north,randomUUID())).body;
    const before=(await call('GET','/api/till-session',null,north)).body;
    assert.equal((await call('POST','/api/till-session/close',{closingCount:before.expectedCash,managerPin:'836194'},north)).status,200);
    assert.equal((await call('POST','/api/till-session/open',{openingFloat:100},north)).status,200);
    assert.equal((await call('POST',`/api/transactions/${sale.saleId}/refund`,{managerPin:'836194',reason:'Later day refund'},north)).status,200);
    assert.equal((await call('GET','/api/till-session',null,north)).body.expectedCash,88);
    assert.equal(Number((await admin.query('select expected_cash from till_sessions where id=$1',[before.id])).rows[0].expected_cash),before.expectedCash);
  });
  await t.test('full refund reverses the sale loyalty points',async()=>{
    const customer=await call('POST','/api/customers',{displayName:'Loyalty test'},north);assert.equal(customer.status,200);
    const sale=await call('POST','/api/checkout',{...basket,customerId:customer.body.id},north,randomUUID());assert.equal(sale.status,200);
    assert.equal(sale.body.pointsEarned,12);
    assert.equal((await call('POST',`/api/transactions/${sale.body.saleId}/refund`,{managerPin:'836194',reason:'Loyalty reversal'},north)).status,200);
    assert.equal((await call('GET',`/api/customers/${customer.body.id}`,null,north)).body.points,0);
  });
  await t.test('database failure makes readiness fail while liveness stays available',async()=>{
    const original=pool.query;pool.query=async()=>{throw new Error('Test connection failure')};
    try{assert.equal((await call('GET','/health')).status,503);assert.equal((await call('GET','/health/live')).status,200);}finally{pool.query=original;}
  });
  await t.test('suspension takes effect before JWT expiry and cashier cannot edit catalogue',async()=>{
    const email=`cashier-${suffix}@test.example`;
    assert.equal((await call('POST','/api/staff',{email,displayName:'Cashier',role:'cashier',pin:'628413'},north)).status,200);
    const staff=(await call('POST','/api/auth/pin',{email,pin:'628413'})).body;
    assert.equal((await call('POST','/api/products',{name:'Forbidden',sku:'x',gtin:'12345678',retailPrice:1},staff)).status,403);
    await admin.query("update organisation_memberships set status='suspended' where user_id=$1",[staff.user.id]);
    assert.equal((await call('GET','/api/products',null,staff)).status,401);
  });
  await t.test('password reset tokens are one-use and revoke existing sessions',async()=>{
    const token=randomUUID(),hash=createHash('sha256').update(token).digest('hex');
    await admin.query('select app_reset_request($1,$2)',[south.user.email,hash]);
    assert.equal((await admin.query('select app_reset_complete($1,$2) ok',[hash,'not-a-login-hash'])).rows[0].ok,true);
    assert.equal((await admin.query('select app_reset_complete($1,$2) ok',[hash,'not-a-login-hash'])).rows[0].ok,false);
    assert.equal((await call('GET','/api/products',null,south)).status,401);
  });
  await t.test('MFA enrolment revokes sessions and rejects reused codes',async()=>{
    const active=(await call('POST','/api/auth/pin',{email:south.user.email,pin:'836194'})).body;
    const setup=await call('POST','/api/auth/mfa/setup',{},active);assert.equal(setup.status,200);
    const {totp}=await import('../src/mfa.js'),code=totp(setup.body.secret,Math.floor(Date.now()/30000));
    assert.equal((await call('POST','/api/auth/mfa/confirm',{code},active)).status,200);
    assert.equal((await call('GET','/api/products',null,active)).status,401);
    assert.equal((await call('POST','/api/auth/pin',{email:south.user.email,pin:'836194',code})).status,401);
  });
  await t.test('logout revokes the server session',async()=>{
    assert.equal((await call('POST','/api/auth/logout',{},north)).status,200);
    assert.equal((await call('GET','/api/products',null,north)).status,401);
  });
});
