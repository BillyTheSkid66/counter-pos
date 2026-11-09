import {randomUUID} from 'node:crypto';
import {pool} from './db.js';
import { SignJWT, jwtVerify } from 'jose';
import { config } from './config.js';

const secret = new TextEncoder().encode(config.JWT_SECRET);
const platformAdmins=new Set(config.PLATFORM_ADMIN_EMAILS.split(',').map(x=>x.trim().toLowerCase()).filter(Boolean));
export const isPlatformAdmin=email=>platformAdmins.has(String(email).toLowerCase());

const writePolicies=[
  {method:'POST',pattern:/^\/api\/(checkout|customers|parked-baskets|till-session\/(open|movement|close)|transactions\/[^/]+\/(refund|return|partial-refund))$/,roles:['owner','admin','manager','supervisor','cashier']},
  {method:'DELETE',pattern:/^\/api\/parked-baskets\/[^/]+$/,roles:['owner','admin','manager','supervisor','cashier']},
  {method:'POST',pattern:/^\/api\/(categories|staff|loyalty-reward-tiers|announcements)$/,roles:['owner','admin','manager']},
  {method:'PATCH',pattern:/^\/api\/(categories|announcements)\/[^/]+$/,roles:['owner','admin','manager']},
  {method:'DELETE',pattern:/^\/api\/(loyalty-reward-tiers|announcements)\/[^/]+$/,roles:['owner','admin','manager']},
  {method:'POST',pattern:/^\/api\/announcements\/[^/]+\/archive$/,roles:['owner','admin','manager']},
  {method:'POST',pattern:/^\/api\/announcements\/read$/,roles:['owner','admin','manager','supervisor','cashier','stock']},
  {method:'PUT',pattern:/^\/api\/(receipt-settings|loyalty-program)$/,roles:['owner','admin','manager']},
  {method:'POST',pattern:/^\/api\/inventory\/(adjust|stocktake)$/,roles:['owner','admin','manager','supervisor','stock']},
  {method:'PUT',pattern:/^\/api\/inventory\/[^/]+\/reorder-level$/,roles:['owner','admin','manager','supervisor','stock']},

  {method:'POST',pattern:/^\/api\/(products|product-families)$/,roles:['owner','admin','manager','stock']},
  {method:'PUT',pattern:/^\/api\/product-families\/[^/]+\/category$/,roles:['owner','admin','manager','stock']},
  {method:'PATCH',pattern:/^\/api\/product-variants\/[^/]+$/,roles:['owner','admin','manager']},
  {method:'POST',pattern:/^\/api\/(suppliers|purchase-orders)$/,roles:['owner','admin','manager','stock']},
  {method:'POST',pattern:/^\/api\/purchase-orders\/[^/]+\/receive$/,roles:['owner','admin','manager','stock']},
  {method:'POST',pattern:/^\/api\/promotions$/,roles:['owner','admin','manager']},
];

export async function createToken(user) {
  const sessionId=randomUUID();
  await pool.query('select app_session_create($1,$2,$3,$4)',[sessionId,user.id,new Date(Date.now()+8*60*60*1000),user.parentSessionId||null]);
  return new SignJWT({ email: user.email, name: user.display_name, organisationId:user.organisation_id, role:user.role, supportReadOnly:Boolean(user.supportReadOnly),mfaVerified:Boolean(user.mfaVerified) })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(user.id)
    .setJti(sessionId).setIssuer('counter-api').setAudience('counter-pos').setIssuedAt().setExpirationTime('8h').sign(secret);
}

export async function requireAuth(request) {
  const token=request.headers.authorization?.replace(/^Bearer\s+/i,'');
  let payload;
  try { ({payload}=await jwtVerify(token,secret,{algorithms:['HS256'],issuer:'counter-api',audience:'counter-pos'})); }
  catch {throw Object.assign(new Error('Invalid or expired session'),{statusCode:401});}
  const valid=(await pool.query('select app_session_valid($1,$2) valid',[payload.jti,payload.sub])).rows[0]?.valid;
  if(!valid)throw Object.assign(new Error('Session revoked or expired'),{statusCode:401});
  const identity=(await pool.query('select * from app_auth_identity($1,$2)',[payload.sub,payload.supportReadOnly?null:payload.organisationId||null])).rows[0];
  if(!identity)throw Object.assign(new Error('Account access revoked'),{statusCode:401});
  request.user={id:payload.sub,email:identity.email,name:identity.display_name,organisationId:payload.organisationId||identity.organisation_id,role:payload.supportReadOnly?'support':identity.role,supportReadOnly:Boolean(payload.supportReadOnly),sessionId:payload.jti,mfaVerified:Boolean(payload.mfaVerified)};
  const path=request.url.split('?')[0];
  if(request.user.supportReadOnly){
    const subscription=(await pool.query('select * from app_subscription($1)',[request.user.organisationId])).rows[0];
    if(!subscription?.support_access_enabled||!isPlatformAdmin(request.user.email)||request.method!=='GET')throw Object.assign(new Error('Support sessions are read-only or access has been revoked'),{statusCode:403});
  }
  if(config.REQUIRE_ADMIN_MFA==='true'&&isPlatformAdmin(request.user.email)&&!request.user.mfaVerified&&!path.startsWith('/api/auth/'))throw Object.assign(new Error('Set up an authenticator in Account security, then sign in with its code'),{statusCode:403});
  const policy=writePolicies.find(item=>item.method===request.method&&item.pattern.test(path));
  if(policy&&!policy.roles.includes(request.user.role))throw Object.assign(new Error('Insufficient permission'),{statusCode:403});
  if(!['GET','HEAD'].includes(request.method)&&!path.startsWith('/api/auth/')&&!path.startsWith('/api/platform/')&&!policy)throw Object.assign(new Error('This operation has no permission policy'),{statusCode:403});
}

export function tenantContext(request) {
  const organisationId=request.headers['x-organisation-id'];
  if(!organisationId||organisationId!==request.user.organisationId)throw Object.assign(new Error('Organisation access denied'),{statusCode:403});
  return {organisationId,userId:request.user.id,supportReadOnly:request.user.supportReadOnly};
}
