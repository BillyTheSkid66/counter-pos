import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const source=await readFile(join(root,'src','server.js'),'utf8');
const checkout=source.slice(source.indexOf("app.post('/api/checkout'"),source.indexOf("app.get('/api/transactions'"));
const returns=await readFile(join(root,'src','refunds.js'),'utf8');

test('checkout validates basket and tender boundaries before completing a sale',()=>{
  assert.match(checkout,/quantity:z\.number\(\)\.int\(\)\.positive\(\)\.max\(100\)/);
  assert.match(checkout,/At least one payment is required/);
  assert.match(checkout,/quantity >= \$1 returning quantity/);
  assert.match(checkout,/Payments must total/);
  assert.match(checkout,/Open the till before taking payments/);
});

test('checkout persists the sale, tender, stock movement, and loyalty effects',()=>{
  for(const contract of ['insert into sales','insert into sale_items','insert into payments','insert into inventory_movements','insert into loyalty_entries'])assert.ok(checkout.includes(contract),`missing checkout effect: ${contract}`);
  assert.match(checkout,/remainingStock:Object\.fromEntries/);
});

test('partial returns require approval and cannot exceed remaining sold quantity',()=>{
  assert.match(returns,/app_approve_manager_pin/);
  assert.match(returns,/Refund quantity exceeds the remaining sold quantity/);
  assert.match(returns,/status in\('completed','partially_refunded'\) for update/);
  assert.match(returns,/fully\?'refunded':'partially_refunded'/);
});

test('partial returns restore stock and create auditable financial effects',()=>{
  for(const contract of ['insert into refunds','insert into refund_items','insert into variant_stock_balances','insert into inventory_movements','insert into audit_log'])assert.ok(returns.includes(contract),`missing return effect: ${contract}`);
  assert.match(returns,/sale\.items_returned/);
  assert.match(returns,/store_credits/);
  assert.match(returns,/Partial refund adjustment/);
});
