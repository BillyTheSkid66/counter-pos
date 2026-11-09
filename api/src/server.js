import {loginSession,registerSecurity} from './security.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import bcrypt from 'bcryptjs';
import { z as strictZ } from 'zod';
import { config } from './config.js';
import { once } from './idempotency.js';
import { cents, pounds, priceLines } from './money.js';
import { registerRefundRoutes, sessionSummary } from './refunds.js';
import { pool, withTenant } from './db.js';
import { createToken, isPlatformAdmin, requireAuth, tenantContext } from './auth.js';

// PostgreSQL accepts the full 8-4-4-4-12 UUID representation. Our deterministic
// demo IDs use that valid representation without claiming a specific RFC version.
const z={...strictZ,string:(...args)=>{const schema=strictZ.string(...args);schema.uuid=()=>schema.guid();return schema}};

export const app = Fastify({ logger: config.NODE_ENV==='test'?false:{redact:['req.headers.authorization','req.headers.cookie']}, trustProxy: config.TRUSTED_PROXIES ? config.TRUSTED_PROXIES.split(',').map(x=>x.trim()) : false, bodyLimit: 1_000_000 });
await app.register(cors, { origin: config.CORS_ORIGIN.split(','), credentials: true });
await app.register(helmet,{contentSecurityPolicy:false});
await app.register(rateLimit,{max:300,timeWindow:'1 minute'});

app.get('/health/live', async () => ({status:'ok',service:'counter-api'}));
app.get('/health', async (_request,reply) => {try{await pool.query('select 1');return {status:'ok',service:'counter-api',database:'ok'}}catch{return reply.code(503).send({status:'unavailable',service:'counter-api',database:'unavailable'})}});

registerSecurity(app);

const featureGuard=feature=>async request=>{
  await requireAuth(request);
  const organisationId=request.headers['x-organisation-id'];
  if(!organisationId||organisationId!==request.user.organisationId)throw Object.assign(new Error('Organisation access denied'),{statusCode:403});
  const result=await pool.query('select app_has_feature($1,$2) allowed',[organisationId,feature]);
  if(!result.rows[0]?.allowed)throw Object.assign(new Error(`Your plan does not include ${feature}`),{statusCode:403});
};
const requirePlatformAdmin=async request=>{await requireAuth(request);if(!isPlatformAdmin(request.user.email))throw Object.assign(new Error('Platform owner access required'),{statusCode:403});};

app.get('/api/public/plans',async()=>({plans:(await pool.query('select * from app_public_plans()')).rows}));

app.post('/api/public/trials',{config:{rateLimit:{max:5,timeWindow:'1 hour'}}},async request=>{
  const input=z.object({businessName:z.string().trim().min(2).max(160),ownerName:z.string().trim().min(2).max(160),email:z.string().email(),pin:z.string().regex(/^\d{4,8}$/),planId:z.enum(['inventory','counter','pro']),templateId:z.enum(['vape','convenience','cafe','bakery','pub','clothing','gifts','pets','hardware','salon','blank'])}).parse(request.body);
  const trial=(await pool.query('select * from app_start_trial($1,$2,$3,$4,$5,$6)',[input.businessName,input.email.toLowerCase(),input.ownerName,input.pin,input.planId,input.templateId])).rows[0];
  const user={id:trial.user_id,email:trial.email,display_name:trial.display_name,organisation_id:trial.organisation_id,role:trial.role};
  return{token:await createToken(user),organisation:{id:trial.organisation_id,name:trial.organisation_name},user:{id:user.id,email:user.email,name:user.display_name,role:user.role},subscription:{planId:trial.plan_id,status:'trialing',trialEndsAt:trial.trial_ends_at,features:trial.features}};
});

app.post('/api/auth/login',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async request => {
  const input = z.object({ email: z.string().email(), password: z.string().min(8).max(72), code:z.string().regex(/^\d{6}$/).optional() }).parse(request.body);
  const result = await pool.query('select * from app_login_user($1)', [input.email.toLowerCase()]);
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(input.password, user.password_hash))) {
    throw Object.assign(new Error('Invalid email or password'), { statusCode: 401 });
  }
  return loginSession(user,input.code);
});

app.post('/api/auth/pin',{config:{rateLimit:{max:5,timeWindow:'5 minutes'}}},async request=>{
  const input=z.object({email:z.string().email(),pin:z.string().regex(/^\d{4,8}$/),code:z.string().regex(/^\d{6}$/).optional()}).parse(request.body);
  const {rows:[staff]}=await pool.query('select * from app_pin_login_user($1,$2)',[input.email.toLowerCase(),input.pin]);
  if(!staff)throw Object.assign(new Error('Invalid email or PIN'),{statusCode:401});
  return loginSession({...staff,id:staff.user_id},input.code);
});

app.get('/api/platform/subscriptions',{preHandler:requirePlatformAdmin},async()=>({subscriptions:(await pool.query('select * from app_platform_subscriptions()')).rows}));
app.get('/api/platform/subscriptions/:id/audit',{preHandler:requirePlatformAdmin},async request=>({audit:(await pool.query('select * from app_platform_audit($1)',[z.string().uuid().parse(request.params.id)])).rows}));
app.patch('/api/platform/subscriptions/:id',{preHandler:requirePlatformAdmin},async request=>{const input=z.object({planId:z.enum(['inventory','counter','pro']).nullable().optional(),status:z.enum(['trialing','active','complimentary','past_due','paused','cancelling','cancelled']).nullable().optional(),trialEndsAt:z.string().datetime().nullable().optional(),complimentaryUntil:z.string().datetime().nullable().optional(),foundingPriceEndsAt:z.string().datetime().nullable().optional(),cancelAtPeriodEnd:z.boolean().nullable().optional(),creditDelta:z.number().nullable().optional(),featureOverrides:z.record(z.string(),z.boolean()).nullable().optional(),overrideExpiresAt:z.string().datetime().nullable().optional(),supportAccessEnabled:z.boolean().nullable().optional(),reason:z.string().trim().min(3).max(500)}).parse(request.body);const value=x=>x?new Date(x):null;return{subscription:(await pool.query('select app_platform_update_subscription($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) subscription',[request.user.id,z.string().uuid().parse(request.params.id),input.planId??null,input.status??null,value(input.trialEndsAt),value(input.complimentaryUntil),value(input.foundingPriceEndsAt),input.cancelAtPeriodEnd??null,input.creditDelta??null,input.featureOverrides??null,value(input.overrideExpiresAt),input.supportAccessEnabled??null,input.reason])).rows[0].subscription}});
app.post('/api/platform/subscriptions/:id/support-session',{preHandler:requirePlatformAdmin},async request=>{const organisationId=z.string().uuid().parse(request.params.id),subscription=(await pool.query('select * from app_subscription($1)',[organisationId])).rows[0];if(!subscription?.support_access_enabled)throw Object.assign(new Error('The customer has not enabled support access'),{statusCode:403});const organisations=(await pool.query('select * from app_platform_subscriptions()')).rows,organisation=organisations.find(x=>x.organisation_id===organisationId);const supportUser={id:request.user.id,email:request.user.email,display_name:request.user.name,organisation_id:organisationId,role:'support',supportReadOnly:true,mfaVerified:request.user.mfaVerified,parentSessionId:request.user.sessionId};return{token:await createToken(supportUser),supportReadOnly:true,organisation:{id:organisationId,name:organisation?.organisation_name||'Customer workspace'},user:{id:request.user.id,email:request.user.email,name:`${request.user.name} (support)`,role:'support'},subscription:{planId:subscription.plan_id,planName:subscription.plan_name,status:subscription.status,features:subscription.features,limits:subscription.limits}}});

app.get('/api/subscription',{preHandler:requireAuth},async request=>{const organisationId=request.headers['x-organisation-id'];if(organisationId!==request.user.organisationId)throw Object.assign(new Error('Organisation access denied'),{statusCode:403});return(await pool.query('select * from app_subscription($1)',[organisationId])).rows[0]||null});

app.get('/api/announcements',{preHandler:requireAuth},async request=>withTenant(tenantContext(request),async(client,membership)=>{const includeArchived=request.query?.archived==='true'&&['owner','admin','manager'].includes(membership.role);return(await client.query(`select a.id,a.title,a.body,a.audience,a.expires_at,a.archived_at,a.created_at,a.updated_at,app_user_display_name(a.created_by) created_by,(r.read_at is not null) is_read from announcements a left join announcement_reads r on r.announcement_id=a.id and r.user_id=$1 where ($2::boolean or a.archived_at is null) and ($2::boolean or a.expires_at is null or a.expires_at>now()) and ($2::boolean or a.audience='all' or (a.audience='management' and $3=any(array['owner','admin','manager','supervisor'])) or (a.audience='cashiers' and $3=any(array['cashier','supervisor']))) order by a.archived_at nulls first,a.created_at desc`,[request.user.id,includeArchived,membership.role])).rows}));
app.post('/api/announcements',{preHandler:requireAuth},async request=>{const input=z.object({title:z.string().trim().min(1).max(160),body:z.string().trim().max(2000).default(''),audience:z.enum(['all','management','cashiers']).default('all'),expiresAt:z.string().datetime().nullable().optional()}).parse(request.body);return withTenant(tenantContext(request),async(client,membership)=>{if(!['owner','admin','manager'].includes(membership.role))throw Object.assign(new Error('Manager access required'),{statusCode:403});const org=request.headers['x-organisation-id'],row=(await client.query('insert into announcements(organisation_id,title,body,audience,expires_at,created_by) values($1,$2,$3,$4,$5,$6) returning *',[org,input.title,input.body,input.audience,input.expiresAt?new Date(input.expiresAt):null,request.user.id])).rows[0];await client.query("insert into audit_log(organisation_id,actor_user_id,action,entity_type,entity_id,metadata) values($1,$2,'announcement.created','announcement',$3,$4)",[org,request.user.id,row.id,JSON.stringify({title:row.title,audience:row.audience})]);return row})});
app.patch('/api/announcements/:id',{preHandler:requireAuth},async request=>{const id=z.string().uuid().parse(request.params.id),input=z.object({title:z.string().trim().min(1).max(160),body:z.string().trim().max(2000),audience:z.enum(['all','management','cashiers']),expiresAt:z.string().datetime().nullable()}).parse(request.body);return withTenant(tenantContext(request),async(client,membership)=>{if(!['owner','admin','manager'].includes(membership.role))throw Object.assign(new Error('Manager access required'),{statusCode:403});const row=(await client.query('update announcements set title=$1,body=$2,audience=$3,expires_at=$4,updated_at=now() where id=$5 and archived_at is null returning *',[input.title,input.body,input.audience,input.expiresAt?new Date(input.expiresAt):null,id])).rows[0];if(!row)throw Object.assign(new Error('Announcement not found or archived'),{statusCode:404});return row})});
app.post('/api/announcements/:id/archive',{preHandler:requireAuth},async request=>withTenant(tenantContext(request),async(client,membership)=>{if(!['owner','admin','manager'].includes(membership.role))throw Object.assign(new Error('Manager access required'),{statusCode:403});const id=z.string().uuid().parse(request.params.id),row=(await client.query('update announcements set archived_at=now(),updated_at=now() where id=$1 and archived_at is null returning id,title',[id])).rows[0];if(!row)throw Object.assign(new Error('Announcement not found'),{statusCode:404});return{archived:true}}));
app.post('/api/announcements/read',{preHandler:requireAuth},async request=>{const input=z.object({ids:z.array(z.string().uuid()).max(100)}).parse(request.body);return withTenant(tenantContext(request),async client=>{const org=request.headers['x-organisation-id'];for(const id of input.ids)await client.query('insert into announcement_reads(organisation_id,announcement_id,user_id) select $1,id,$2 from announcements where id=$3 on conflict(organisation_id,announcement_id,user_id) do update set read_at=now()',[org,request.user.id,id]);return{read:true}})});
app.delete('/api/announcements/:id',{preHandler:requireAuth},async request=>withTenant(tenantContext(request),async(client,membership)=>{if(!['owner','admin','manager'].includes(membership.role))throw Object.assign(new Error('Manager access required'),{statusCode:403});const id=z.string().uuid().parse(request.params.id),org=request.headers['x-organisation-id'];const r=await client.query('delete from announcements where id=$1 returning id,title',[id]);if(!r.rowCount)throw Object.assign(new Error('Announcement not found'),{statusCode:404});await client.query("insert into audit_log(organisation_id,actor_user_id,action,entity_type,entity_id,metadata) values($1,$2,'announcement.deleted','announcement',$3,$4)",[org,request.user.id,id,JSON.stringify({title:r.rows[0].title})]);return{deleted:true}}));

app.get('/api/organisations', { preHandler: requireAuth }, async request => {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.current_user_id', $1, true)", [request.user.id]);
    const result = await client.query('select * from app_user_organisations($1)', [request.user.id]);
    await client.query('commit');
    return result.rows;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
});

app.get('/api/receipt-settings',{preHandler:requireAuth},async request=>withTenant(tenantContext(request),async client=>{const r=await client.query(`select name,coalesce(settings->'receipt','{}'::jsonb) receipt from organisations where id=$1`,[request.headers['x-organisation-id']]);if(!r.rowCount)throw Object.assign(new Error('Organisation not found'),{statusCode:404});return{businessName:r.rows[0].receipt.businessName||r.rows[0].name,address:r.rows[0].receipt.address||'',phone:r.rows[0].receipt.phone||'',email:r.rows[0].receipt.email||'',vatNumber:r.rows[0].receipt.vatNumber||'',footer:r.rows[0].receipt.footer||'Thank you for your custom',returnsPolicy:r.rows[0].receipt.returnsPolicy||'Please retain this receipt for returns.'}}));

app.put('/api/receipt-settings',{preHandler:requireAuth},async request=>{const x=z.object({businessName:z.string().min(2).max(160),address:z.string().max(500),phone:z.string().max(50),email:z.union([z.string().email(),z.literal('')]),vatNumber:z.string().max(30),footer:z.string().max(300),returnsPolicy:z.string().max(500)}).parse(request.body);return withTenant(tenantContext(request),async(client,membership)=>{if(!['owner','admin','manager'].includes(membership.role))throw Object.assign(new Error('Manager access required'),{statusCode:403});const org=request.headers['x-organisation-id'];await client.query(`update organisations set settings=jsonb_set(settings,'{receipt}',$1::jsonb,true),updated_at=now() where id=$2`,[JSON.stringify(x),org]);await client.query(`insert into audit_log(organisation_id,actor_user_id,action,entity_type,entity_id,metadata) values($1,$2,'receipt.settings_updated','organisation',$1,$3)`,[org,request.user.id,JSON.stringify({vatNumber:x.vatNumber})]);return x})});

app.get('/api/staff',{preHandler:requireAuth},async request=>withTenant(tenantContext(request),async(client,membership)=>{if(!['owner','admin','manager'].includes(membership.role))throw Object.assign(new Error('Manager access required'),{statusCode:403});return(await client.query('select * from app_org_staff()')).rows}));

app.post('/api/staff',{preHandler:requireAuth},async request=>{const input=z.object({email:z.string().email(),displayName:z.string().min(2).max(160),role:z.enum(['admin','manager','supervisor','cashier','stock']),pin:z.string().regex(/^\d{4,8}$/)}).parse(request.body);return withTenant(tenantContext(request),async(client,membership)=>{if(!['owner','admin','manager'].includes(membership.role))throw Object.assign(new Error('Manager access required'),{statusCode:403});if(input.role==='admin'&&!['owner','admin'].includes(membership.role))throw Object.assign(new Error('Only owners and admins can create administrators'),{statusCode:403});const staff=(await client.query('select * from app_create_staff($1,$2,$3,$4)',[input.email,input.displayName,input.role,input.pin])).rows[0];await client.query('insert into audit_log(organisation_id,actor_user_id,action,entity_type,entity_id,metadata) values($1,$2,$3,$4,$5,$6)',[request.headers['x-organisation-id'],request.user.id,'staff.created','user',staff.user_id,JSON.stringify({role:input.role})]);return staff})});

app.get('/api/products', { preHandler: requireAuth }, async request => withTenant(tenantContext(request), async client => {
  const result = await client.query('select id, category_id, sku, name, description, retail_price, cost_price, active from products order by name');
  return result.rows;
}));

app.get('/api/categories',{preHandler:requireAuth},async request=>withTenant(tenantContext(request),async client=>{
  const result=await client.query(`select c.id,c.parent_id,c.name,c.display_order,c.tax_rate,c.target_margin,c.active,
    p.name parent_name,count(distinct f.id)::int product_count,
    coalesce(sum(case when v.id is not null then v.retail_price*coalesce(s.quantity,0) else 0 end),0) retail_stock_value
    from categories c left join categories p on p.id=c.parent_id
    left join product_families f on f.category_id=c.id
    left join product_variants v on v.family_id=f.id and v.active
    left join variant_stock_balances s on s.variant_id=v.id
    group by c.id,p.name order by c.display_order,c.name`);
  return result.rows.map(row=>({id:row.id,parentId:row.parent_id,parentName:row.parent_name,name:row.name,displayOrder:row.display_order,taxRate:Number(row.tax_rate),targetMargin:row.target_margin==null?null:Number(row.target_margin),active:row.active,productCount:row.product_count,retailStockValue:Number(row.retail_stock_value)}));
}));

app.post('/api/categories',{preHandler:requireAuth},async request=>{const input=z.object({name:z.string().trim().min(1).max(100),parentId:z.string().uuid().nullable().optional(),taxRate:z.number().min(0).max(100).default(20),targetMargin:z.number().min(0).max(100).nullable().optional()}).parse(request.body);return withTenant(tenantContext(request),async(client,membership)=>{if(!['owner','admin','manager'].includes(membership.role))throw Object.assign(new Error('Manager access required'),{statusCode:403});const org=request.headers['x-organisation-id'];const order=Number((await client.query('select coalesce(max(display_order),0)+1 n from categories')).rows[0].n);const row=(await client.query('insert into categories(organisation_id,parent_id,name,display_order,tax_rate,target_margin) values($1,$2,$3,$4,$5,$6) returning *',[org,input.parentId||null,input.name,order,input.taxRate,input.targetMargin??null])).rows[0];await client.query("insert into audit_log(organisation_id,actor_user_id,action,entity_type,entity_id,metadata) values($1,$2,'category.created','category',$3,$4)",[org,request.user.id,row.id,JSON.stringify({name:row.name})]);return row})});

app.patch('/api/categories/:id',{preHandler:requireAuth},async request=>{const id=z.string().uuid().parse(request.params.id),input=z.object({displayOrder:z.number().int().nonnegative().optional(),active:z.boolean().optional()}).refine(x=>Object.keys(x).length>0).parse(request.body);return withTenant(tenantContext(request),async(client,membership)=>{if(!['owner','admin','manager'].includes(membership.role))throw Object.assign(new Error('Manager access required'),{statusCode:403});const row=(await client.query('update categories set display_order=coalesce($1,display_order),active=coalesce($2,active) where id=$3 returning *',[input.displayOrder??null,input.active??null,id])).rows[0];if(!row)throw Object.assign(new Error('Category not found'),{statusCode:404});return row})});

app.put('/api/product-families/:id/category',{preHandler:requireAuth},async request=>{const uuidText=z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),id=uuidText.parse(request.params.id),input=z.object({categoryId:uuidText.nullable()}).parse(request.body);return withTenant(tenantContext(request),async(client,membership)=>{if(!['owner','admin','manager'].includes(membership.role))throw Object.assign(new Error('Manager access required'),{statusCode:403});const row=(await client.query('update product_families set category_id=$1,updated_at=now() where id=$2 returning id,category_id',[input.categoryId,id])).rows[0];if(!row)throw Object.assign(new Error('Product family not found'),{statusCode:404});return row})});

app.get('/api/inventory',{preHandler:requireAuth},async request=>withTenant(tenantContext(request),async client=>{const stock=await client.query(`select v.id,v.sku,v.display_name,v.option_values,v.reorder_level,f.name family_name,f.brand,l.id location_id,l.name location_name,coalesce(b.quantity,0) quantity,(select gtin from variant_barcodes where variant_id=v.id order by is_primary desc limit 1) gtin from product_variants v join product_families f on f.id=v.family_id cross join lateral(select id,name from locations where active order by created_at limit 1)l left join variant_stock_balances b on b.variant_id=v.id and b.location_id=l.id where v.active order by f.name,v.display_name`);const movements=await client.query(`select m.id,m.variant_id,m.quantity_delta,m.reason,m.created_at,v.display_name,v.sku,app_user_display_name(m.created_by) staff_name from inventory_movements m join product_variants v on v.id=m.variant_id order by m.created_at desc limit 30`);return{stock:stock.rows.map(x=>({...x,quantity:Number(x.quantity),reorderLevel:Number(x.reorder_level),lowStock:Number(x.quantity)<=Number(x.reorder_level)})),movements:movements.rows.map(x=>({...x,quantityDelta:Number(x.quantity_delta)}))}}));

app.post('/api/inventory/adjust',{preHandler:requireAuth},async request=>{const x=z.object({variantId:z.string().uuid(),quantityDelta:z.number().int().refine(v=>v!==0),reason:z.string().trim().min(2).max(200),kind:z.enum(['adjustment','wastage','receipt']).default('adjustment')}).parse(request.body);return withTenant(tenantContext(request),async(client,membership)=>{if(!['owner','admin','manager','supervisor','stock'].includes(membership.role))throw Object.assign(new Error('Stock permission required'),{statusCode:403});const org=request.headers['x-organisation-id'];const l=await client.query('select id from locations where active order by created_at limit 1');const current=await client.query('select quantity from variant_stock_balances where location_id=$1 and variant_id=$2 for update',[l.rows[0].id,x.variantId]);const before=current.rowCount?Number(current.rows[0].quantity):0,after=before+x.quantityDelta;if(after<0)throw Object.assign(new Error('Adjustment would make stock negative'),{statusCode:409});await client.query(`insert into variant_stock_balances(organisation_id,location_id,variant_id,quantity) values($1,$2,$3,$4) on conflict(organisation_id,location_id,variant_id) do update set quantity=excluded.quantity,updated_at=now()`,[org,l.rows[0].id,x.variantId,after]);await client.query(`insert into inventory_movements(organisation_id,location_id,variant_id,movement_type,quantity_delta,reference_type,reason,created_by) values($1,$2,$3,$4,$5,$6,$7,$8)`,[org,l.rows[0].id,x.variantId,x.kind==='receipt'?'receipt':'adjustment',x.quantityDelta,x.kind,x.reason,request.user.id]);return{variantId:x.variantId,before,after}})});

app.post('/api/inventory/stocktake',{preHandler:requireAuth},async request=>{const x=z.object({counts:z.array(z.object({variantId:z.string().uuid(),count:z.number().int().nonnegative()})).min(1),reason:z.string().trim().min(2).max(200).default('Stocktake count')}).parse(request.body);return withTenant(tenantContext(request),async(client,membership)=>{if(!['owner','admin','manager','supervisor','stock'].includes(membership.role))throw Object.assign(new Error('Stock permission required'),{statusCode:403});const org=request.headers['x-organisation-id'],l=(await client.query('select id from locations where active order by created_at limit 1')).rows[0],changes=[];for(const item of x.counts){const r=await client.query('select quantity from variant_stock_balances where location_id=$1 and variant_id=$2 for update',[l.id,item.variantId]);const before=r.rowCount?Number(r.rows[0].quantity):0,diff=item.count-before;if(diff===0)continue;await client.query(`insert into variant_stock_balances(organisation_id,location_id,variant_id,quantity) values($1,$2,$3,$4) on conflict(organisation_id,location_id,variant_id) do update set quantity=excluded.quantity,updated_at=now()`,[org,l.id,item.variantId,item.count]);await client.query(`insert into inventory_movements(organisation_id,location_id,variant_id,movement_type,quantity_delta,reference_type,reason,created_by) values($1,$2,$3,'stocktake',$4,'stocktake',$5,$6)`,[org,l.id,item.variantId,diff,x.reason,request.user.id]);changes.push({variantId:item.variantId,before,after:item.count,difference:diff})}return{counted:x.counts.length,changes}})});

app.put('/api/inventory/:id/reorder-level',{preHandler:requireAuth},async request=>{const id=z.string().uuid().parse(request.params.id),x=z.object({reorderLevel:z.number().int().nonnegative()}).parse(request.body);return withTenant(tenantContext(request),async(client,membership)=>{if(!['owner','admin','manager','supervisor','stock'].includes(membership.role))throw Object.assign(new Error('Stock permission required'),{statusCode:403});const r=await client.query('update product_variants set reorder_level=$1,updated_at=now() where id=$2 returning id,reorder_level',[x.reorderLevel,id]);if(!r.rowCount)throw Object.assign(new Error('Variant not found'),{statusCode:404});return{id:r.rows[0].id,reorderLevel:Number(r.rows[0].reorder_level)}})});

app.post('/api/products', { preHandler: requireAuth }, async request => {
  const input = z.object({ name: z.string().min(1).max(160), sku: z.string().min(1).max(64), gtin: z.string().regex(/^(\d{8}|\d{12,14})$/), categoryId: z.string().uuid().nullable().optional(), retailPrice: z.number().nonnegative(), costPrice: z.number().nonnegative().default(0) }).parse(request.body);
  return withTenant(tenantContext(request), async client => {
    const product = await client.query('insert into products (organisation_id, category_id, sku, name, retail_price, cost_price) values ($1,$2,$3,$4,$5,$6) returning *', [request.headers['x-organisation-id'], input.categoryId ?? null, input.sku, input.name, input.retailPrice, input.costPrice]);
    await client.query('insert into product_barcodes (organisation_id, product_id, gtin, is_primary) values ($1,$2,$3,true)', [request.headers['x-organisation-id'], product.rows[0].id, input.gtin]);
    return product.rows[0];
  });
});

app.get('/api/product-families', { preHandler: requireAuth }, async request => withTenant(tenantContext(request), async client => {
  const result = await client.query(`
    select f.id family_id,f.name family_name,f.brand,f.size_label,f.description,f.active family_active,
      v.id variant_id,v.sku,v.display_name,v.option_values,v.cost_price,v.retail_price,v.active variant_active,
      b.gtin,coalesce(s.quantity,0) stock
    from product_families f
    left join product_variants v on v.organisation_id=f.organisation_id and v.family_id=f.id
    left join variant_barcodes b on b.organisation_id=v.organisation_id and b.variant_id=v.id and b.is_primary
    left join variant_stock_balances s on s.organisation_id=v.organisation_id and s.variant_id=v.id
    order by f.name,v.display_name
  `);
  const families = new Map();
  for (const row of result.rows) {
    if (!families.has(row.family_id)) families.set(row.family_id, {
      id: row.family_id, name: row.family_name, brand: row.brand, sizeLabel: row.size_label,
      description: row.description, active: row.family_active, variants: []
    });
    if (row.variant_id) families.get(row.family_id).variants.push({
      id: row.variant_id, sku: row.sku, name: row.display_name, options: row.option_values,
      costPrice: Number(row.cost_price), retailPrice: Number(row.retail_price),
      gtin: row.gtin, stock: Number(row.stock), active: row.variant_active
    });
  }
  return [...families.values()];
}));

app.post('/api/product-families', { preHandler: requireAuth }, async request => {
  const variantSchema = z.object({
    sku: z.string().trim().min(1).max(64),
    gtin: z.string().regex(/^(\d{8}|\d{12,14})$/),
    options: z.record(z.string(), z.string().min(1)).refine(value => Object.keys(value).length > 0),
    costPrice: z.number().nonnegative(), retailPrice: z.number().nonnegative(), stock: z.number().nonnegative()
  });
  const input = z.object({
    name: z.string().trim().min(1).max(160), brand: z.string().trim().max(100).optional(),
    sizeLabel: z.string().trim().max(40).optional(), description: z.string().trim().max(1000).optional(),
    categoryId: z.string().uuid().nullable().optional(), variants: z.array(variantSchema).min(1).max(500)
  }).parse(request.body);
  return withTenant(tenantContext(request), async client => {
    const organisationId = request.headers['x-organisation-id'];
    const location = await client.query('select id from locations where active order by created_at limit 1');
    if (!location.rowCount) throw Object.assign(new Error('Create a store location before adding stock'), { statusCode: 422 });
    const family = await client.query(
      'insert into product_families(organisation_id,category_id,name,brand,size_label,description) values($1,$2,$3,$4,$5,$6) returning *',
      [organisationId,input.categoryId??null,input.name,input.brand||null,input.sizeLabel||null,input.description||null]
    );
    for (const variant of input.variants) {
      const label = Object.values(variant.options).join(' · ');
      const created = await client.query(
        'insert into product_variants(organisation_id,family_id,sku,display_name,option_values,cost_price,retail_price) values($1,$2,$3,$4,$5,$6,$7) returning id',
        [organisationId,family.rows[0].id,variant.sku,label,variant.options,variant.costPrice,variant.retailPrice]
      );
      await Promise.all([
        client.query('insert into variant_barcodes(organisation_id,variant_id,gtin) values($1,$2,$3)',[organisationId,created.rows[0].id,variant.gtin]),
        client.query('insert into variant_stock_balances(organisation_id,location_id,variant_id,quantity) values($1,$2,$3,$4)',[organisationId,location.rows[0].id,created.rows[0].id,variant.stock])
      ]);
    }
    return {id: family.rows[0].id, name: family.rows[0].name, variantsCreated: input.variants.length};
  });
});

app.patch('/api/product-variants/:id',{preHandler:requireAuth},async request=>{
  const id=z.string().uuid().parse(request.params.id);
  const input=z.object({sku:z.string().trim().min(1).max(64),gtin:z.string().regex(/^(\d{8}|\d{12,14})$/),costPrice:z.number().nonnegative(),retailPrice:z.number().nonnegative(),active:z.boolean()}).parse(request.body);
  return withTenant(tenantContext(request),async(client,membership)=>{
    if(!['owner','admin','manager'].includes(membership.role))throw Object.assign(new Error('Catalogue permission required'),{statusCode:403});
    const variant=(await client.query('update product_variants set sku=$1,cost_price=$2,retail_price=$3,active=$4,updated_at=now() where id=$5 returning id,sku,cost_price,retail_price,active',[input.sku,input.costPrice,input.retailPrice,input.active,id])).rows[0];
    if(!variant)throw Object.assign(new Error('Variant not found'),{statusCode:404});
    const barcode=await client.query('select id from variant_barcodes where variant_id=$1 and is_primary order by id limit 1',[id]);
    if(barcode.rowCount)await client.query('update variant_barcodes set gtin=$1 where id=$2',[input.gtin,barcode.rows[0].id]);
    else await client.query('insert into variant_barcodes(organisation_id,variant_id,gtin,is_primary) values($1,$2,$3,true)',[request.headers['x-organisation-id'],id,input.gtin]);
    await client.query("insert into audit_log(organisation_id,actor_user_id,action,entity_type,entity_id,metadata) values($1,$2,'variant.updated','product_variant',$3,$4)",[request.headers['x-organisation-id'],request.user.id,id,JSON.stringify({sku:input.sku,gtin:input.gtin})]);
    return{...variant,costPrice:Number(variant.cost_price),retailPrice:Number(variant.retail_price),gtin:input.gtin};
  });
});

app.post('/api/checkout', { preHandler: featureGuard('pos') }, async request => {
  const input = z.object({
    items: z.array(z.object({variantId:z.string().uuid(),quantity:z.number().int().positive().max(100)})).min(1).max(100),
    paymentMethod:z.enum(['cash','card','voucher','other']).optional(),payments:z.array(z.object({method:z.enum(['cash','card','voucher','store_credit','other']),amount:z.number().positive().refine(v=>Math.abs(v*100-Math.round(v*100))<0.000001,{message:'Use whole pennies'}),referenceCode:z.string().trim().max(40).optional()})).max(5).optional(),customerId:z.string().uuid().nullable().optional(),redeemPoints:z.number().int().nonnegative().default(0)
  }).refine(x=>new Set(x.items.map(i=>i.variantId)).size===x.items.length,{message:'Duplicate basket items are not allowed'}).refine(x=>x.paymentMethod||x.payments?.length,{message:'At least one payment is required'}).parse(request.body);
  return withTenant(tenantContext(request), async client => {
    const organisationId=request.headers['x-organisation-id'];
    return once(client,organisationId,request.user.id,request.headers['idempotency-key'],input,async()=>{
    if(input.customerId){const customer=await client.query('select id from customers where id=$1 for update',[input.customerId]);if(!customer.rowCount)throw Object.assign(new Error('Customer not found'),{statusCode:404});}
    const device=await client.query('select t.id till_id,t.location_id,s.id session_id from tills t join till_sessions s on s.till_id=t.id and s.closed_at is null where t.active order by t.created_at limit 1 for update of s');
    if(!device.rowCount) throw Object.assign(new Error('Open the till before taking payments'),{statusCode:422});
    const lines=[];
    for(const item of [...input.items].sort((a,b)=>a.variantId.localeCompare(b.variantId))){
      const variant=await client.query(`select v.id,v.sku,v.display_name,v.retail_price,coalesce(c.tax_rate,v.tax_rate) tax_rate,f.id family_id,f.name family_name
        from product_variants v join product_families f on f.organisation_id=v.organisation_id and f.id=v.family_id
        left join categories c on c.id=f.category_id
        where v.id=$1 and v.active and f.active`,[item.variantId]);
      if(!variant.rowCount) throw Object.assign(new Error('A selected variant is unavailable'),{statusCode:409});
      const stock=await client.query(`update variant_stock_balances set quantity=quantity-$1,updated_at=now()
        where organisation_id=$2 and location_id=$3 and variant_id=$4 and quantity >= $1 returning quantity`,
        [item.quantity,organisationId,device.rows[0].location_id,item.variantId]);
      if(!stock.rowCount) throw Object.assign(new Error(`${variant.rows[0].family_name} · ${variant.rows[0].display_name} has insufficient stock`),{statusCode:409});
      lines.push({...variant.rows[0],quantity:item.quantity,remaining:Number(stock.rows[0].quantity)});
    }
    const regularTotal=lines.reduce((sum,line)=>sum+Number(line.retail_price)*line.quantity,0);
    const promos=await client.query(`select p.*,array_agg(gf.family_id) families from promotions p join promotion_group_families gf on gf.group_id=p.group_id where p.active and (p.starts_at is null or p.starts_at<=now()) and (p.ends_at is null or p.ends_at>=now()) group by p.id`);
    let applied=null;for(const p of promos.rows){const units=[];for(const line of lines)if(p.families.includes(line.family_id))for(let n=0;n<line.quantity;n++)units.push(Number(line.retail_price));units.sort((a,b)=>b-a);let saving=0;for(let n=0;n+Number(p.qualifying_quantity)<=units.length;n+=Number(p.qualifying_quantity))saving+=Math.max(0,units.slice(n,n+Number(p.qualifying_quantity)).reduce((a,b)=>a+b,0)-Number(p.bundle_price));if(saving>(applied?.saving||0))applied={...p,saving:Number(saving.toFixed(2))};}
    const programme=(await client.query('select * from loyalty_programs where organisation_id=$1',[organisationId])).rows[0]||{enabled:true,points_per_pound:1,expiry_months:null};
    const promotionDiscount=applied?.saving||0;let loyaltyDiscount=0,rewardName=null;if(input.redeemPoints){if(!programme.enabled||!input.customerId)throw Object.assign(new Error('A customer and active loyalty programme are required'),{statusCode:422});const tier=await client.query('select name,reward_value from loyalty_reward_tiers where active and points_cost=$1',[input.redeemPoints]);if(!tier.rowCount)throw Object.assign(new Error('That loyalty reward is unavailable'),{statusCode:422});const bal=await client.query('select coalesce(sum(points_delta),0) balance from loyalty_entries where customer_id=$1 and (expires_at is null or expires_at>now())',[input.customerId]);if(Number(bal.rows[0].balance)<input.redeemPoints)throw Object.assign(new Error('Insufficient loyalty points'),{statusCode:409});loyaltyDiscount=Number(tier.rows[0].reward_value);rewardName=tier.rows[0].name;if(loyaltyDiscount>regularTotal-promotionDiscount)throw Object.assign(new Error('Basket value is too low to use this reward'),{statusCode:422});}const discount=promotionDiscount+loyaltyDiscount,subtotal=Number((regularTotal-discount).toFixed(2));
    const priced=priceLines(lines,discount,applied);
    const tax=pounds(priced.reduce((sum,line)=>sum+cents(line.tax),0));
    const sale=await client.query(`insert into sales(organisation_id,location_id,till_id,till_session_id,staff_user_id,customer_id,status,subtotal,tax_total,grand_total,completed_at)
      values($1,$2,$3,$4,$5,$6,'completed',$7,$8,$7,now()) returning id,receipt_number,completed_at`,
      [organisationId,device.rows[0].location_id,device.rows[0].till_id,device.rows[0].session_id,request.user.id,input.customerId??null,subtotal,tax]);
    if(discount>0)await client.query('update sales set discount_total=$1 where id=$2',[discount,sale.rows[0].id]);if(promotionDiscount>0)await client.query('insert into sale_promotions(organisation_id,sale_id,promotion_id,description,discount_total) values($1,$2,$3,$4,$5)',[organisationId,sale.rows[0].id,applied.id,applied.name,promotionDiscount]);
    for(const line of priced){
      await client.query(`insert into sale_items(organisation_id,sale_id,variant_id,sku_snapshot,name_snapshot,quantity,unit_price,tax_total,line_total)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[organisationId,sale.rows[0].id,line.id,line.sku,`${line.family_name} · ${line.display_name}`,line.quantity,line.retail_price,line.tax,line.total]);
      await client.query(`insert into inventory_movements(organisation_id,location_id,variant_id,movement_type,quantity_delta,reference_type,reference_id,created_by)
        values($1,$2,$3,'sale',$4,'sale',$5,$6)`,[organisationId,device.rows[0].location_id,line.id,-line.quantity,sale.rows[0].id,request.user.id]);
    }
    const tenders=input.payments?.length?input.payments:[{method:input.paymentMethod,amount:subtotal}],tenderTotal=Number(tenders.reduce((s,p)=>s+p.amount,0).toFixed(2));if(tenderTotal!==subtotal)throw Object.assign(new Error(`Payments must total ${subtotal.toFixed(2)}`),{statusCode:422});for(const tender of tenders){if(tender.amount===0)continue;if(tender.method==='store_credit'){if(!tender.referenceCode)throw Object.assign(new Error('Enter the store credit code'),{statusCode:422});const credit=await client.query(`update store_credits set balance=balance-$1 where upper(code)=upper($2) and balance>=$1 and (expires_at is null or expires_at>now()) returning id`,[tender.amount,tender.referenceCode]);if(!credit.rowCount)throw Object.assign(new Error('Store credit is invalid, expired or has insufficient balance'),{statusCode:409});}await client.query(`insert into payments(organisation_id,sale_id,method,provider_reference,amount,status,till_session_id) values($1,$2,$3,$4,$5,'completed',$6)`,[organisationId,sale.rows[0].id,tender.method,tender.referenceCode||null,tender.amount,device.rows[0].session_id]);}
    const points=programme.enabled&&input.customerId?Math.floor(subtotal*programme.points_per_pound):0;
    if(input.customerId){if(input.redeemPoints)await client.query('insert into loyalty_entries(organisation_id,customer_id,sale_id,points_delta,reason) values($1,$2,$3,$4,$5)',[organisationId,input.customerId,sale.rows[0].id,-input.redeemPoints,rewardName||'Reward redeemed']);if(points>0)await client.query(`insert into loyalty_entries(organisation_id,customer_id,sale_id,points_delta,reason,expires_at) values($1,$2,$3,$4,$5,case when $6::int is null then null else now()+make_interval(months=>$6) end)`,[organisationId,input.customerId,sale.rows[0].id,points,'Purchase reward',programme.expiry_months]);}
    return {saleId:sale.rows[0].id,receiptNumber:sale.rows[0].receipt_number,total:subtotal,regularTotal,discount,promotionDiscount,loyaltyDiscount,promotion:applied?.name??null,pointsEarned:points,completedAt:sale.rows[0].completed_at,remainingStock:Object.fromEntries(lines.map(line=>[line.id,line.remaining]))};
    });
  });
});

app.get('/api/transactions', { preHandler: requireAuth }, async request => withTenant(tenantContext(request), async client => {
  const sales=await client.query(`select s.id,s.receipt_number,s.status,s.subtotal,s.tax_total,s.grand_total,s.completed_at,
    app_user_display_name(s.staff_user_id) staff_name,coalesce((select case when count(distinct p.method)>1 then 'split' else min(p.method) end from payments p where p.sale_id=s.id and p.status='completed'),'other') payment_method,
    (select count(*) from sale_items i where i.sale_id=s.id) item_lines
    from sales s where s.status <> 'draft' order by s.completed_at desc nulls last limit 100`);
  return sales.rows.map(row=>({...row,subtotal:Number(row.subtotal),taxTotal:Number(row.tax_total),total:Number(row.grand_total),itemLines:Number(row.item_lines)}));
}));

app.get('/api/reports/management',{preHandler:featureGuard('reports')},async request=>withTenant(tenantContext(request),async(client,membership)=>{
  if(!['owner','admin','manager','supervisor'].includes(membership.role))throw Object.assign(new Error('Management access required'),{statusCode:403});
  const days=z.coerce.number().int().min(1).max(366).default(7).parse(request.query?.days??7);
  const summary=(await client.query(`select coalesce(sum(s.grand_total),0) gross_sales,coalesce(sum(s.discount_total),0) discounts,count(*) transactions,coalesce(sum(s.tax_total),0) gross_vat,coalesce(sum(r.total),0) refunds from sales s left join lateral(select sum(total) total from refunds where sale_id=s.id)r on true where s.completed_at>=current_date-($1::int-1)*interval '1 day'`,[days])).rows[0];
  const daily=await client.query(`select d::date as report_day,coalesce(sum(s.grand_total),0)-coalesce(sum(r.total),0) net_sales,count(s.id) transactions from generate_series(current_date-($1::int-1)*interval '1 day',current_date,interval '1 day')d left join sales s on s.completed_at>=d and s.completed_at<d+interval '1 day' left join lateral(select sum(total) total from refunds where sale_id=s.id)r on true group by d order by d`,[days]);
  const tenders=await client.query(`select method,coalesce(sum(amount),0) total from payments p join sales s on s.id=p.sale_id where p.status='completed' and s.completed_at>=current_date-($1::int-1)*interval '1 day' group by method order by total desc`,[days]);
  const top=await client.query(`select i.name_snapshot name,i.sku_snapshot sku,sum(i.quantity-coalesce(r.quantity,0)) units,sum(i.line_total-coalesce(r.amount,0)) sales from sale_items i join sales s on s.id=i.sale_id left join lateral(select sum(quantity) quantity,sum(amount) amount from refund_items where sale_item_id=i.id)r on true where s.completed_at>=current_date-($1::int-1)*interval '1 day' group by i.name_snapshot,i.sku_snapshot order by sales desc limit 8`,[days]);
  const tills=await client.query(`select ts.opened_at,ts.closed_at,t.name till_name,ts.expected_cash,ts.closing_count,ts.discrepancy from till_sessions ts join tills t on t.id=ts.till_id where ts.opened_at>=current_date-($1::int-1)*interval '1 day' order by ts.opened_at desc limit 12`,[days]);
  const low=await client.query(`select v.display_name,v.sku,b.quantity,v.reorder_level from product_variants v join variant_stock_balances b on b.variant_id=v.id where b.quantity<=v.reorder_level order by b.quantity asc limit 12`);
  const gross=Number(summary.gross_sales),refunds=Number(summary.refunds),net=Number((gross-refunds).toFixed(2)),vat=Number((Number(summary.gross_vat)-refunds/6).toFixed(2));
  return{periodDays:days,generatedAt:new Date().toISOString(),summary:{grossSales:gross,netSales:net,refunds,discounts:Number(summary.discounts),transactions:Number(summary.transactions),averageBasket:Number(summary.transactions)?Number((net/Number(summary.transactions)).toFixed(2)):0,vat},daily:daily.rows.map(x=>({day:x.report_day,netSales:Number(x.net_sales),transactions:Number(x.transactions)})),tenders:tenders.rows.map(x=>({...x,total:Number(x.total)})),topProducts:top.rows.map(x=>({...x,units:Number(x.units),sales:Number(x.sales)})),tillSessions:tills.rows.map(x=>({...x,expectedCash:x.expected_cash===null?null:Number(x.expected_cash),closingCount:x.closing_count===null?null:Number(x.closing_count),discrepancy:x.discrepancy===null?null:Number(x.discrepancy)})),lowStock:low.rows.map(x=>({...x,quantity:Number(x.quantity),reorderLevel:Number(x.reorder_level)}))};
}));

app.get('/api/parked-baskets',{preHandler:requireAuth},async request=>withTenant(tenantContext(request),async client=>(await client.query(`select p.*,app_user_display_name(p.staff_user_id) staff_name,c.display_name customer_name from parked_baskets p left join customers c on c.id=p.customer_id order by p.created_at desc`)).rows));
app.post('/api/parked-baskets',{preHandler:requireAuth},async request=>{const x=z.object({items:z.array(z.object({variantId:z.string().uuid(),quantity:z.number().int().positive()})).min(1),customerId:z.string().uuid().nullable().optional(),redeemPoints:z.number().int().nonnegative().default(0),note:z.string().max(120).default('')}).parse(request.body);return withTenant(tenantContext(request),async client=>(await client.query('insert into parked_baskets(organisation_id,staff_user_id,customer_id,items,redeem_points,note) values($1,$2,$3,$4,$5,$6) returning *',[request.headers['x-organisation-id'],request.user.id,x.customerId||null,JSON.stringify(x.items),x.redeemPoints,x.note])).rows[0])});
app.delete('/api/parked-baskets/:id',{preHandler:requireAuth},async request=>withTenant(tenantContext(request),async client=>{const id=z.string().uuid().parse(request.params.id);const r=await client.query('delete from parked_baskets where id=$1 returning *',[id]);if(!r.rowCount)throw Object.assign(new Error('Parked basket not found'),{statusCode:404});return r.rows[0]}));

app.get('/api/store-credits/:code',{preHandler:requireAuth},async request=>withTenant(tenantContext(request),async client=>{
  const code=z.string().trim().min(4).max(40).parse(request.params.code);
  const result=await client.query(`select code,balance,original_amount,expires_at,created_at from store_credits where upper(code)=upper($1)`,[code]);
  if(!result.rowCount)throw Object.assign(new Error('Store credit code not found'),{statusCode:404});
  const credit=result.rows[0],active=Number(credit.balance)>0&&(!credit.expires_at||new Date(credit.expires_at)>new Date());
  return{code:credit.code,balance:Number(credit.balance),originalAmount:Number(credit.original_amount),expiresAt:credit.expires_at,active};
}));

app.get('/api/transactions/:id', { preHandler: requireAuth }, async request => withTenant(tenantContext(request), async client => {
  const id=z.string().uuid().parse(request.params.id);
  const sale=await client.query(`select s.*,app_user_display_name(s.staff_user_id) staff_name,l.name location_name,t.name till_name,o.name organisation_name,o.settings->'receipt' receipt_settings,
    coalesce((select case when count(distinct p.method)>1 then 'split' else min(p.method) end from payments p where p.sale_id=s.id and p.status='completed'),'other') payment_method
    from sales s join locations l on l.id=s.location_id join tills t on t.id=s.till_id join organisations o on o.id=s.organisation_id where s.id=$1`,[id]);
  if(!sale.rowCount) throw Object.assign(new Error('Transaction not found'),{statusCode:404});
  const items=await client.query('select id,sku_snapshot,name_snapshot,quantity,unit_price,tax_total,line_total,variant_id,coalesce((select sum(quantity) from refund_items where sale_item_id=sale_items.id),0) refunded_quantity from sale_items where sale_id=$1 order by id',[id]);
  const refunds=await client.query('select id,total,reason,created_at from refunds where sale_id=$1 order by created_at',[id]);
  return {...sale.rows[0],subtotal:Number(sale.rows[0].subtotal),discountTotal:Number(sale.rows[0].discount_total),taxTotal:Number(sale.rows[0].tax_total),total:Number(sale.rows[0].grand_total),items:items.rows.map(x=>({...x,quantity:Number(x.quantity),refundedQuantity:Number(x.refunded_quantity),unitPrice:Number(x.unit_price),taxTotal:Number(x.tax_total),lineTotal:Number(x.line_total)})),refunds:refunds.rows.map(x=>({...x,total:Number(x.total)}))};
}));

registerRefundRoutes(app);

app.get('/api/till-session',{preHandler:requireAuth},async request=>withTenant(tenantContext(request),async client=>{const r=await client.query('select id from till_sessions where closed_at is null order by opened_at desc limit 1');return r.rowCount?sessionSummary(client,r.rows[0].id):null}));
app.post('/api/till-session/open',{preHandler:requireAuth},async request=>{const input=z.object({openingFloat:z.number().nonnegative()}).parse(request.body);return withTenant(tenantContext(request),async client=>{const org=request.headers['x-organisation-id'];const till=await client.query('select id from tills where active order by created_at limit 1');if(!till.rowCount)throw Object.assign(new Error('No till configured'),{statusCode:422});const r=await client.query('insert into till_sessions(organisation_id,till_id,opened_by,opening_float) values($1,$2,$3,$4) returning id',[org,till.rows[0].id,request.user.id,input.openingFloat]);return sessionSummary(client,r.rows[0].id)});});
app.post('/api/till-session/movement',{preHandler:requireAuth},async request=>{const input=z.object({type:z.enum(['paid_in','paid_out']),amount:z.number().positive(),reason:z.string().min(2).max(200)}).parse(request.body);return withTenant(tenantContext(request),async client=>{const org=request.headers['x-organisation-id'];const s=await client.query('select id from till_sessions where closed_at is null limit 1 for update');if(!s.rowCount)throw Object.assign(new Error('No open till'),{statusCode:409});await client.query('insert into cash_movements(organisation_id,session_id,movement_type,amount,reason,created_by) values($1,$2,$3,$4,$5,$6)',[org,s.rows[0].id,input.type,input.amount,input.reason,request.user.id]);return sessionSummary(client,s.rows[0].id)});});
app.post('/api/till-session/close',{preHandler:requireAuth},async request=>{const input=z.object({closingCount:z.number().nonnegative(),managerPin:z.string().regex(/^\d{4,8}$/),reason:z.string().max(300).optional()}).parse(request.body);return withTenant(tenantContext(request),async client=>{const org=request.headers['x-organisation-id'];const s=await client.query('select id from till_sessions where closed_at is null for update');if(!s.rowCount)throw Object.assign(new Error('No open till'),{statusCode:409});const summary=await sessionSummary(client,s.rows[0].id);const discrepancy=Number((input.closingCount-summary.expectedCash).toFixed(2));if(discrepancy!==0){const ok=await client.query('select app_approve_manager_pin($1,$2,$3) approved',[org,request.user.id,input.managerPin]);if(!ok.rows[0].approved||!input.reason?.trim())throw Object.assign(new Error('Manager approval and discrepancy reason required'),{statusCode:403});}await client.query('update till_sessions set closed_by=$1,closing_count=$2,expected_cash=$3,discrepancy=$4,discrepancy_reason=$5,closed_at=now() where id=$6',[request.user.id,input.closingCount,summary.expectedCash,discrepancy,input.reason||null,s.rows[0].id]);return {...summary,closingCount:input.closingCount,discrepancy,status:'closed'}});});

app.get('/api/purchasing',{preHandler:requireAuth},async request=>withTenant(tenantContext(request),async client=>{const suppliers=await client.query('select * from suppliers order by name');const orders=await client.query(`select p.*,s.name supplier_name,coalesce(sum(i.ordered_quantity*i.unit_cost),0) total,count(i.id) lines from purchase_orders p join suppliers s on s.id=p.supplier_id left join purchase_order_items i on i.purchase_order_id=p.id group by p.id,s.name order by p.created_at desc`);return {suppliers:suppliers.rows,orders:orders.rows.map(x=>({...x,total:Number(x.total),lines:Number(x.lines)}))}}));
app.post('/api/suppliers',{preHandler:requireAuth},async request=>{const x=z.object({name:z.string().min(2),email:z.string().email().optional()}).parse(request.body);return withTenant(tenantContext(request),async client=>(await client.query('insert into suppliers(organisation_id,name,email) values($1,$2,$3) returning *',[request.headers['x-organisation-id'],x.name,x.email||null])).rows[0]);});
app.post('/api/purchase-orders',{preHandler:requireAuth},async request=>{const x=z.object({supplierId:z.string().uuid(),items:z.array(z.object({variantId:z.string().uuid(),quantity:z.number().positive(),unitCost:z.number().nonnegative()})).min(1)}).parse(request.body);return withTenant(tenantContext(request),async client=>{const org=request.headers['x-organisation-id'];const l=await client.query('select id from locations where active limit 1');const p=await client.query("insert into purchase_orders(organisation_id,supplier_id,location_id,status,created_by) values($1,$2,$3,'sent',$4) returning *",[org,x.supplierId,l.rows[0].id,request.user.id]);for(const i of x.items)await client.query('insert into purchase_order_items(organisation_id,purchase_order_id,variant_id,ordered_quantity,unit_cost) values($1,$2,$3,$4,$5)',[org,p.rows[0].id,i.variantId,i.quantity,i.unitCost]);return p.rows[0]});});
app.post('/api/purchase-orders/:id/receive',{preHandler:requireAuth},async request=>withTenant(tenantContext(request),async client=>{const org=request.headers['x-organisation-id'];const id=z.string().uuid().parse(request.params.id);const p=await client.query('select * from purchase_orders where id=$1 for update',[id]);if(!p.rowCount)throw Object.assign(new Error('Order not found'),{statusCode:404});const lines=await client.query('select * from purchase_order_items where purchase_order_id=$1',[id]);for(const i of lines.rows){const q=Number(i.ordered_quantity)-Number(i.received_quantity);if(q<=0)continue;await client.query('update purchase_order_items set received_quantity=ordered_quantity where id=$1',[i.id]);await client.query('insert into variant_stock_balances(organisation_id,location_id,variant_id,quantity) values($1,$2,$3,$4) on conflict(organisation_id,location_id,variant_id) do update set quantity=variant_stock_balances.quantity+excluded.quantity,updated_at=now()',[org,p.rows[0].location_id,i.variant_id,q]);await client.query('update product_variants set cost_price=$1 where id=$2',[i.unit_cost,i.variant_id]);await client.query("insert into inventory_movements(organisation_id,location_id,variant_id,movement_type,quantity_delta,unit_cost,reference_type,reference_id,created_by) values($1,$2,$3,'receipt',$4,$5,'purchase_order',$6,$7)",[org,p.rows[0].location_id,i.variant_id,q,i.unit_cost,id,request.user.id]);}await client.query("update purchase_orders set status='completed' where id=$1",[id]);return {id,status:'completed'}}));

app.get('/api/customers',{preHandler:requireAuth},async request=>withTenant(tenantContext(request),async client=>{const r=await client.query(`select c.*,coalesce(l.points,0) points,coalesce(s.visits,0) visits,coalesce(s.spend,0) spend from customers c left join lateral(select sum(points_delta) points from loyalty_entries where customer_id=c.id and(expires_at is null or expires_at>now()))l on true left join lateral(select count(*) visits,coalesce(sum(grand_total) filter(where status='completed'),0) spend from sales where customer_id=c.id)s on true order by c.display_name`);return r.rows.map(x=>({...x,points:Number(x.points),visits:Number(x.visits),spend:Number(x.spend)}))}));
app.post('/api/customers',{preHandler:requireAuth},async request=>{const x=z.object({displayName:z.string().min(2).max(160),email:z.string().email().optional(),phone:z.string().max(40).optional(),marketingConsent:z.boolean().default(false)}).parse(request.body);return withTenant(tenantContext(request),async client=>{const org=request.headers['x-organisation-id'];const customer=(await client.query('insert into customers(organisation_id,display_name,email,phone,marketing_consent) values($1,$2,$3,$4,$5) returning *',[org,x.displayName,x.email?.toLowerCase()||null,x.phone||null,x.marketingConsent])).rows[0];const p=(await client.query('select enabled,welcome_bonus,expiry_months from loyalty_programs where organisation_id=$1',[org])).rows[0];if(p?.enabled&&p.welcome_bonus>0)await client.query(`insert into loyalty_entries(organisation_id,customer_id,points_delta,reason,expires_at) values($1,$2,$3,'Welcome bonus',case when $4::int is null then null else now()+make_interval(months=>$4) end)`,[org,customer.id,p.welcome_bonus,p.expiry_months]);return customer});});

app.get('/api/customers/:id',{preHandler:requireAuth},async request=>withTenant(tenantContext(request),async client=>{const id=z.string().uuid().parse(request.params.id);const customer=await client.query(`select c.*,coalesce(sum(l.points_delta) filter(where l.expires_at is null or l.expires_at>now()),0) points from customers c left join loyalty_entries l on l.customer_id=c.id where c.id=$1 group by c.id`,[id]);if(!customer.rowCount)throw Object.assign(new Error('Customer not found'),{statusCode:404});const activity=await client.query(`select l.id,l.points_delta,l.reason,l.expires_at,l.created_at,s.receipt_number,s.grand_total from loyalty_entries l left join sales s on s.id=l.sale_id where l.customer_id=$1 order by l.created_at desc limit 100`,[id]);return{...customer.rows[0],points:Number(customer.rows[0].points),activity:activity.rows.map(x=>({...x,points_delta:Number(x.points_delta),grand_total:x.grand_total===null?null:Number(x.grand_total)}))}}));

app.get('/api/loyalty-program',{preHandler:featureGuard('loyalty')},async request=>withTenant(tenantContext(request),async client=>{const org=request.headers['x-organisation-id'];const programme=(await client.query('select organisation_id,enabled,points_per_pound,welcome_bonus,expiry_months,updated_at from loyalty_programs where organisation_id=$1',[org])).rows[0];const tiers=await client.query('select * from loyalty_reward_tiers order by display_order,points_cost');const stats=(await client.query(`select count(distinct customer_id) members,coalesce(sum(-points_delta) filter(where points_delta<0),0) redeemed_points,coalesce(sum(points_delta) filter(where points_delta>0),0) issued_points from loyalty_entries`)).rows[0];const activity=await client.query(`select l.id,l.points_delta,l.reason,l.created_at,c.display_name from loyalty_entries l join customers c on c.id=l.customer_id order by l.created_at desc limit 8`);return{programme:{...programme,tiers:tiers.rows.map(x=>({...x,reward_value:Number(x.reward_value)}))},stats:{members:Number(stats.members),redeemedPoints:Number(stats.redeemed_points),issuedPoints:Number(stats.issued_points)},activity:activity.rows.map(x=>({...x,points_delta:Number(x.points_delta)}))}}));

app.put('/api/loyalty-program',{preHandler:featureGuard('loyalty')},async request=>{const x=z.object({enabled:z.boolean(),pointsPerPound:z.number().int().min(1).max(100),welcomeBonus:z.number().int().min(0).max(1000000),expiryMonths:z.number().int().min(1).max(120).nullable()}).parse(request.body);return withTenant(tenantContext(request),async(client,membership)=>{if(!['owner','admin','manager'].includes(membership.role))throw Object.assign(new Error('Manager access required'),{statusCode:403});const org=request.headers['x-organisation-id'];return(await client.query(`update loyalty_programs set enabled=$2,points_per_pound=$3,welcome_bonus=$4,expiry_months=$5,updated_at=now() where organisation_id=$1 returning organisation_id,enabled,points_per_pound,welcome_bonus,expiry_months,updated_at`,[org,x.enabled,x.pointsPerPound,x.welcomeBonus,x.expiryMonths])).rows[0]})});

app.post('/api/loyalty-reward-tiers',{preHandler:featureGuard('loyalty')},async request=>{const x=z.object({name:z.string().min(2).max(100),pointsCost:z.number().int().min(1).max(1000000),rewardValue:z.number().positive().max(10000)}).parse(request.body);return withTenant(tenantContext(request),async(client,membership)=>{if(!['owner','admin','manager'].includes(membership.role))throw Object.assign(new Error('Manager access required'),{statusCode:403});return(await client.query('insert into loyalty_reward_tiers(organisation_id,name,points_cost,reward_value,display_order) values($1,$2,$3,$4,(select coalesce(max(display_order),-1)+1 from loyalty_reward_tiers)) returning *',[request.headers['x-organisation-id'],x.name,x.pointsCost,x.rewardValue])).rows[0]})});

app.delete('/api/loyalty-reward-tiers/:id',{preHandler:featureGuard('loyalty')},async request=>withTenant(tenantContext(request),async(client,membership)=>{if(!['owner','admin','manager'].includes(membership.role))throw Object.assign(new Error('Manager access required'),{statusCode:403});const id=z.string().uuid().parse(request.params.id);const r=await client.query('delete from loyalty_reward_tiers where id=$1 returning id',[id]);if(!r.rowCount)throw Object.assign(new Error('Reward tier not found'),{statusCode:404});return{deleted:true}}));

app.get('/api/promotions',{preHandler:requireAuth},async request=>withTenant(tenantContext(request),async client=>(await client.query(`select p.*,g.name group_name,array_agg(f.name order by f.name) families,array_agg(f.id order by f.name) family_ids from promotions p join promotion_groups g on g.id=p.group_id join promotion_group_families gf on gf.group_id=g.id join product_families f on f.id=gf.family_id group by p.id,g.name order by p.created_at desc`)).rows));
app.post('/api/promotions',{preHandler:requireAuth},async request=>{const x=z.object({name:z.string().min(2),groupName:z.string().min(2),familyIds:z.array(z.string().uuid()).min(1),quantity:z.number().int().min(2),bundlePrice:z.number().nonnegative()}).parse(request.body);return withTenant(tenantContext(request),async client=>{const org=request.headers['x-organisation-id'];const g=await client.query('insert into promotion_groups(organisation_id,name) values($1,$2) returning id',[org,x.groupName]);for(const id of x.familyIds)await client.query('insert into promotion_group_families(organisation_id,group_id,family_id) values($1,$2,$3)',[org,g.rows[0].id,id]);return(await client.query('insert into promotions(organisation_id,group_id,name,qualifying_quantity,bundle_price) values($1,$2,$3,$4,$5) returning *',[org,g.rows[0].id,x.name,x.quantity,x.bundlePrice])).rows[0]});});

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Validation failed', details: error.issues });
  const status = error.statusCode ?? (error.code === '23505' ? 409 : 500);
  if (status >= 500) app.log.error(error);
  return reply.code(status).send({ error: status >= 500 ? 'Internal server error' : error.message });
});

const close = async signal => { app.log.info({ signal }, 'shutting down'); await app.close(); await pool.end(); process.exit(0); };
if(config.NODE_ENV!=='test'){process.on('SIGTERM', close); process.on('SIGINT', close);
await app.listen({ port: config.PORT, host: config.HOST });}
