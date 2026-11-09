import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const migration = await readFile(join(root,'migrations','001_saas_foundation.sql'),'utf8');
const variantsMigration = await readFile(join(root,'migrations','002_product_variants.sql'),'utf8');
const checkoutMigration = await readFile(join(root,'migrations','003_variant_checkout.sql'),'utf8');
const refundsMigration = await readFile(join(root,'migrations','004_refunds.sql'),'utf8');
const helpersMigration = await readFile(join(root,'migrations','005_transaction_helpers.sql'),'utf8');
const authSource = await readFile(join(root,'src','auth.js'),'utf8');
const platformMigration = await readFile(join(root,'migrations','018_platform_subscription_admin.sql'),'utf8');
const serverSource = await readFile(join(root,'src','server.js'),'utf8');
const announcementsMigration = await readFile(join(root,'migrations','022_announcement_management.sql'),'utf8');

test('tenant tables have forced row-level security contract', () => {
  assert.match(migration,/alter table organisations force row level security/i);
  for (const table of ['products','customers','sales','payments','inventory_movements','loyalty_entries','audit_log']) {
    assert.ok(migration.includes(`'${table}'`),`${table} must be included in the RLS table list`);
  }
  assert.match(migration,/create policy tenant_isolation/i);
});

test('refunds are tenant isolated, auditable, and use narrow security helpers', () => {
  assert.match(refundsMigration,/create table refunds/i);
  assert.match(refundsMigration,/create table refund_items/i);
  assert.match(refundsMigration,/force row level security/i);
  assert.match(helpersMigration,/security definer set search_path=''/i);
  assert.match(helpersMigration,/app_approve_manager_pin/i);
  assert.doesNotMatch(helpersMigration,/grant select on users/i);
});

test('checkout records variant sale and stock movement relationships', () => {
  assert.match(checkoutMigration,/sale_items add column variant_id uuid/i);
  assert.match(checkoutMigration,/inventory_movements add column variant_id uuid/i);
  assert.match(checkoutMigration,/sale_item_has_catalogue_item/i);
  assert.match(checkoutMigration,/movement_has_catalogue_item/i);
  assert.match(checkoutMigration,/sale_items_variant_id_idx/i);
});

test('product families and variants are tenant isolated and uniquely identifiable', () => {
  for (const table of ['product_families','product_variants','variant_barcodes','variant_stock_balances']) {
    assert.ok(variantsMigration.includes(`'${table}'`),`${table} must be included in the RLS table list`);
  }
  assert.match(variantsMigration,/unique \(organisation_id,sku\)/i);
  assert.match(variantsMigration,/unique \(organisation_id,gtin\)/i);
  assert.match(variantsMigration,/foreign key \(organisation_id,family_id\)/i);
  assert.match(variantsMigration,/product_variants_options_idx/i);
});

test('application role is least-privileged', () => {
  const grantLine = migration.split('\n').find(line=>line.startsWith('grant select,insert,update'));
  assert.ok(grantLine);
  assert.equal(grantLine.includes('delete'),false);
  assert.match(migration,/revoke all on all tables in schema public from public/i);
});

test('tenant foreign keys and hot access paths are indexed', () => {
  assert.match(migration,/foreign key \(organisation_id,product_id\)/i);
  assert.match(migration,/inventory_movements_location_product_idx/i);
  assert.match(migration,/sales_completed_at_idx/i);
  assert.match(migration,/organisation_memberships_user_id_idx/i);
});

test('sensitive catalogue and promotion writes have server-side role policies',()=>{
  assert.match(authSource,/product-families/);
  assert.match(authSource,/purchase-orders/);
  assert.match(authSource,/promotions/);
  assert.match(authSource,/Insufficient permission/);
});

test('platform subscription changes are owner-gated and immutably audited',()=>{
  assert.match(platformMigration,/create table platform_subscription_audit/i);
  assert.match(platformMigration,/before_state jsonb not null/i);
  assert.match(platformMigration,/after_state jsonb not null/i);
  assert.match(platformMigration,/app_platform_update_subscription/i);
  assert.match(serverSource,/requirePlatformAdmin/);
  assert.match(serverSource,/support_access_enabled/);
  assert.match(authSource,/Support sessions are read-only/);
});

test('announcements support tenant-isolated lifecycle and read state',()=>{
  assert.match(announcementsMigration,/audience in \('all','management','cashiers'\)/i);
  assert.match(announcementsMigration,/create table announcement_reads/i);
  assert.match(announcementsMigration,/force row level security/i);
  assert.match(serverSource,/announcement\.created/);
  assert.match(serverSource,/announcements\/:id\/archive/);
  assert.match(serverSource,/announcements\/read/);
});
