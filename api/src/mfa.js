import {randomBytes,createHmac,createCipheriv,createDecipheriv,timingSafeEqual} from 'node:crypto';
import {config} from './config.js';
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newSecret(){return [...randomBytes(32)].map(b=>alphabet[b&31]).join('');}
function decode(secret){let bits='';for(const c of secret)bits+=alphabet.indexOf(c).toString(2).padStart(5,'0');return Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2)));}
export function totp(secret,step){const time=Buffer.alloc(8);time.writeBigUInt64BE(BigInt(step));const hash=createHmac('sha1',decode(secret)).update(time).digest(),offset=hash[19]&15;return String((hash.readUInt32BE(offset)&0x7fffffff)%1_000_000).padStart(6,'0');}
export function verifyTotp(secret,code,now=Date.now()){
  if(!/^\d{6}$/.test(code||''))return null;
  const step=Math.floor(now/30000);
  for(const n of [step,step-1,step+1])if(timingSafeEqual(Buffer.from(totp(secret,n)),Buffer.from(code)))return n;
  return null;
}
function key(){if(!config.MFA_ENCRYPTION_KEY)throw Object.assign(new Error('MFA encryption key must be configured by the server owner'),{statusCode:503});return Buffer.from(config.MFA_ENCRYPTION_KEY,'hex');}
export function encrypt(secret){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv),body=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),body].map(x=>x.toString('base64url')).join('.');}
export function decrypt(value){const [iv,tag,body]=value.split('.').map(v=>Buffer.from(v,'base64url')),cipher=createDecipheriv('aes-256-gcm',key(),iv);cipher.setAuthTag(tag);return Buffer.concat([cipher.update(body),cipher.final()]).toString();}
