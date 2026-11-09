import {createHash} from 'node:crypto';
import {randomBytes} from 'node:crypto';
import bcrypt from 'bcryptjs';
import {z} from 'zod';
import {config} from './config.js';
import {pool} from './db.js';
import {createToken,isPlatformAdmin,requireAuth} from './auth.js';
import {newSecret,encrypt,decrypt,verifyTotp} from './mfa.js';

const digest=token=>createHash('sha256').update(token).digest('hex');
export async function loginSession(user,code){
  const security=(await pool.query('select * from app_security_get($1)',[user.id])).rows[0];
  let mfaVerified=false;
  if(security?.secret){
    const step=verifyTotp(decrypt(security.secret),code);
    if(step===null||!(await pool.query('select app_mfa_verify($1,$2,false) valid',[user.id,step])).rows[0].valid)throw Object.assign(new Error('A fresh authenticator code is required'),{statusCode:401});
    mfaVerified=true;
  }
  const identity=(await pool.query('select * from app_auth_identity($1,$2)',[user.id,user.organisation_id||null])).rows[0];
  if(!identity)throw Object.assign(new Error('No active business membership'),{statusCode:403});
  const subscription=(await pool.query('select * from app_subscription($1)',[identity.organisation_id])).rows[0];
  return {token:await createToken({...user,...identity,mfaVerified}),platformAdmin:isPlatformAdmin(identity.email),mfaSetupRequired:config.REQUIRE_ADMIN_MFA==='true'&&isPlatformAdmin(identity.email)&&!security?.secret,
    organisation:{id:identity.organisation_id,name:identity.organisation_name},user:{id:user.id,email:identity.email,name:identity.display_name,role:identity.role},
    subscription:subscription?{planId:subscription.plan_id,planName:subscription.plan_name,status:subscription.status,features:subscription.features,limits:subscription.limits,trialEndsAt:subscription.trial_ends_at}:null};
}

export function registerSecurity(app){
  app.post('/api/auth/logout',{preHandler:requireAuth},async request=>{await pool.query('select app_session_revoke($1,$2,false)',[request.user.sessionId,request.user.id]);return {ok:true};});
  app.post('/api/auth/logout-all',{preHandler:requireAuth},async request=>{await pool.query('select app_session_revoke($1,$2,true)',[request.user.sessionId,request.user.id]);return {ok:true};});
  app.get('/api/auth/security',{preHandler:requireAuth},async request=>({mfaEnabled:Boolean((await pool.query('select * from app_security_get($1)',[request.user.id])).rows[0]?.secret)}));
  app.post('/api/auth/mfa/setup',{preHandler:requireAuth,config:{rateLimit:{max:5,timeWindow:'10 minutes'}}},async request=>{
    const existing=(await pool.query('select * from app_security_get($1)',[request.user.id])).rows[0];
    if(existing?.secret)throw Object.assign(new Error('An authenticator is already enabled'),{statusCode:409});
    const secret=newSecret();await pool.query('select app_mfa_prepare($1,$2)',[request.user.id,encrypt(secret)]);
    return {secret,uri:`otpauth://totp/Counter:${encodeURIComponent(request.user.email)}?secret=${secret}&issuer=Counter`};
  });
  app.post('/api/auth/mfa/confirm',{preHandler:requireAuth,config:{rateLimit:{max:5,timeWindow:'10 minutes'}}},async request=>{
    const {code}=z.object({code:z.string().regex(/^\d{6}$/)}).parse(request.body);
    const pending=(await pool.query('select * from app_security_get($1)',[request.user.id])).rows[0];
    const step=pending?.pending_secret?verifyTotp(decrypt(pending.pending_secret),code):null;
    if(step===null||!(await pool.query('select app_mfa_verify($1,$2,true) valid',[request.user.id,step])).rows[0].valid)throw Object.assign(new Error('Invalid authenticator code'),{statusCode:400});
    await pool.query('select app_session_revoke($1,$2,true)',[request.user.sessionId,request.user.id]);
    return {ok:true};
  });
  app.post('/api/auth/password-reset',{config:{rateLimit:{max:3,timeWindow:'15 minutes'}}},async request=>{
    const {email}=z.object({email:z.string().email()}).parse(request.body);
    if(!config.SMTP_URL||!config.MAIL_FROM)throw Object.assign(new Error('Password recovery email is not configured; contact your administrator'),{statusCode:503});
    const token=randomBytes(32).toString('hex');
    const found=(await pool.query('select app_reset_request($1,$2) found',[email,digest(token)])).rows[0].found;
    if(found){
      const {default:nodemailer}=await import('nodemailer');
      try{await nodemailer.createTransport(config.SMTP_URL,{connectionTimeout:10000,socketTimeout:10000}).sendMail({from:config.MAIL_FROM,to:email,subject:'Reset your Counter password',text:`Open ${config.PUBLIC_APP_URL}/reset-password#${token} to set a password. This link expires in 20 minutes. Ignore this email if you did not request it.`});}
      catch(error){app.log.error({code:error.code},'Password recovery delivery failed');}
    }
    return {ok:true,message:'If the account exists, a password reset email has been requested.'};
  });
  app.post('/api/auth/password-reset/complete',{config:{rateLimit:{max:5,timeWindow:'15 minutes'}}},async request=>{
    const {token,password}=z.object({token:z.string().regex(/^[a-f0-9]{64}$/),password:z.string().min(12).max(72)}).parse(request.body);
    const ok=(await pool.query('select app_reset_complete($1,$2) ok',[digest(token),await bcrypt.hash(password,12)])).rows[0].ok;
    if(!ok)throw Object.assign(new Error('Reset link is invalid or expired'),{statusCode:400});
    return {ok:true};
  });
}
