import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
// One environment file, independent of the working directory. Existing shell vars win.
dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false'])
    .default(String(fallback) as 'true' | 'false')
    .transform((v) => v === 'true');
const integer = (fallback: number, min = 1, max = 2147483647) =>
  z.coerce.number().int().min(min).max(max).default(fallback);
export function loadConfig(input: NodeJS.ProcessEnv) {
  const schema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: integer(9000, 1, 65535),
    HOST: z.string().default('127.0.0.1'),
    DATABASE_URL: z
      .string()
      .url()
      .refine((v) => /^postgres(?:ql)?:\/\//.test(v), 'Expected a PostgreSQL URL')
      .refine((v) => {
        try {
          const reserved = new Set([
            'ssl',
            'sslmode',
            'sslcert',
            'sslkey',
            'sslrootcert',
            'uselibpqcompat',
            'options',
          ]);
          return [...new URL(v).searchParams.keys()].every(
            (key) => !reserved.has(key.toLowerCase()),
          );
        } catch {
          return false;
        }
      }, 'Configure TLS and schema through PG_SSL/PG_SCHEMA, not URL overrides'),
    PG_SCHEMA: z
      .string()
      .regex(/^[a-z_][a-z_0-9]*$/)
      .default('public'),
    PG_SSL: bool(false),
    PG_SSL_REJECT_UNAUTHORIZED: bool(true),
    JWT_SECRET: z.string().min(32),
    JWT_EXPIRES_IN: integer(3600, 60, 86400),
    JWT_ISSUER: z.string().default('mini-mirth'),
    JWT_AUDIENCE: z.string().default('mini-mirth-ui'),
    CONFIG_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
    CORS_ORIGINS: z
      .string()
      .default(
        'http://localhost:5173,http://127.0.0.1:5173,http://localhost:9000,http://127.0.0.1:9000',
      ),
    HL7_HOST: z.string().default('127.0.0.1'),
    HL7_PORT: integer(2575, 1, 65535),
    HL7_ENABLED: bool(true),
    HL7_ALLOWED_IPS: z.string().default('127.0.0.1,::1'),
    INBOUND_BASE_URL: z.url().default('http://localhost:9000'),
    INBOUND_PATH: z
      .string()
      .regex(/^\/[A-Za-z0-9/_-]+$/)
      .default('/api/inbound'),
    INBOUND_API_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(32).optional()),
    PAYLOAD_LIMIT_BYTES: integer(1048576, 1024, 10485760),
    REQUEST_TIMEOUT_MS: integer(10000, 100, 120000),
    SCRIPT_TIMEOUT_MS: integer(1000, 10, 10000),
    SCRIPT_MEMORY_MB: integer(16, 4, 64),
    SCRIPT_CONCURRENCY: integer(4, 1, 32),
    OUTBOUND_ALLOWED_HOSTS: z.string().default(''),
    PUBLIC_REGISTRATION: bool(false),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
    MESSAGE_RETENTION_DAYS: integer(30, 1, 3650),
    AUDIT_RETENTION_DAYS: integer(365, 30, 3650),
    RETRY_POLL_MS: integer(5000, 100, 60000),
    SHUTDOWN_TIMEOUT_MS: integer(30000, 1000, 120000),
  });
  const result = schema.safeParse(input);
  if (!result.success)
    throw new Error(
      'Invalid environment: ' +
        result.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; '),
    );
  const e = result.data;
  const list = (s: string) =>
    s
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  const origins = list(e.CORS_ORIGINS);
  if (origins.some((v) => v === '*' || !/^https?:\/\/[^/]+$/.test(v)) || !origins.length)
    throw new Error('CORS_ORIGINS must contain explicit HTTP(S) origins');
  if (e.NODE_ENV === 'production' && (!e.PG_SSL || !e.PG_SSL_REJECT_UNAUTHORIZED))
    throw new Error('Production requires verified encrypted PostgreSQL connections');
  if (e.NODE_ENV === 'production' && !e.OUTBOUND_ALLOWED_HOSTS)
    throw new Error('Production requires OUTBOUND_ALLOWED_HOSTS');
  return {
    production: e.NODE_ENV === 'production',
    server: {
      port: e.PORT,
      host: e.HOST,
      shutdownTimeout: e.SHUTDOWN_TIMEOUT_MS,
      payloadLimit: e.PAYLOAD_LIMIT_BYTES,
    },
    database: {
      connectionString: e.DATABASE_URL,
      schema: e.PG_SCHEMA,
      database: decodeURIComponent(new URL(e.DATABASE_URL).pathname.slice(1)),
      ssl: e.PG_SSL ? { rejectUnauthorized: e.PG_SSL_REJECT_UNAUTHORIZED } : (false as const),
    },
    auth: {
      jwtSecret: e.JWT_SECRET,
      expiration: e.JWT_EXPIRES_IN,
      issuer: e.JWT_ISSUER,
      audience: e.JWT_AUDIENCE,
      publicRegistration: e.PUBLIC_REGISTRATION,
    },
    encryptionKey: e.CONFIG_ENCRYPTION_KEY,
    cors: { allowedOrigins: origins },
    hl7: {
      host: e.HL7_HOST,
      port: e.HL7_PORT,
      enabled: e.HL7_ENABLED,
      allowedIps: list(e.HL7_ALLOWED_IPS),
    },
    inbound: {
      baseUrl: e.INBOUND_BASE_URL,
      path: e.INBOUND_PATH.replace(/\/$/, ''),
      apiKey: e.INBOUND_API_KEY || '',
    },
    transport: { timeout: e.REQUEST_TIMEOUT_MS, allowedHosts: list(e.OUTBOUND_ALLOWED_HOSTS) },
    scripts: {
      timeout: e.SCRIPT_TIMEOUT_MS,
      memoryMb: e.SCRIPT_MEMORY_MB,
      concurrency: e.SCRIPT_CONCURRENCY,
    },
    retention: { messages: e.MESSAGE_RETENTION_DAYS, audit: e.AUDIT_RETENTION_DAYS },
    retryPollMs: e.RETRY_POLL_MS,
    logLevel: e.LOG_LEVEL,
  };
}
export const config = loadConfig(process.env);
