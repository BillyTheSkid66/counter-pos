import test from 'node:test';
import assert from 'node:assert/strict';
import {allocate,priceLines,refundLineAmount} from '../src/money.js';
test('discount allocation preserves pennies and respects mixed VAT rates',()=>{
  const lines=priceLines([{retail_price:12,quantity:1,tax_rate:20},{retail_price:12,quantity:1,tax_rate:0}],4);
  assert.deepEqual(lines.map(x=>x.total),[10,10]);
  assert.deepEqual(lines.map(x=>x.tax),[1.67,0]);
  assert.deepEqual(allocate(100,[1,1,1]),[34,33,33]);
});
test('successive partial refunds return exactly the line amount',()=>{
  assert.deepEqual([0,1,2].map(refunded=>refundLineAmount({quantity:3,refunded,line_total:1},1)),[0.33,0.34,0.33]);
});
test('a promotion only discounts the eligible product families',()=>{
  const lines=priceLines([{family_id:'eligible',retail_price:12,quantity:2,tax_rate:20},{family_id:'other',retail_price:12,quantity:1,tax_rate:0}],4,{saving:4,families:['eligible']});
  assert.deepEqual(lines.map(x=>x.total),[20,12]);
  assert.deepEqual(lines.map(x=>x.tax),[3.33,0]);
});
