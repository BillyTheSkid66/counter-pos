import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default('127.0.0.1'),
  TRUSTED_PROXIES: z.string().default(''),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  DB_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
  DATABASE_TRANSPORT: z.literal('tcp').default('tcp'),
  PUBLIC_APP_URL: z.string().url().default('http://127.0.0.1:5173'),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  MFA_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  REQUIRE_ADMIN_MFA: z.enum(['true','false']).default('true'),
  DATABASE_URL: z.string().url(),
  ADMIN_DATABASE_URL: z.string().url().optional(),
  JWT_SECRET: z.string().min(32),
  CORS_ORIGIN: z.string().default('http://127.0.0.1:5173'),
  PLATFORM_ADMIN_EMAILS: z.string().default('')
});

export const config = schema.parse(process.env);
if(config.NODE_ENV==='production' && /replace|example|development|change.me/i.test(config.JWT_SECRET)) throw new Error('A unique production JWT_SECRET is required');
