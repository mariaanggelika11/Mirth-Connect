import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
// One environment file, independent of the working directory. Existing shell vars win.
dotenv.config({
  path: process.env.ENV_FILE || fileURLToPath(new URL('../../../.env', import.meta.url)),
  quiet: true,
});
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
    PG_SSL_CA_FILE: z.string().optional(),
    TRUST_PROXY: z.string().default(''),
    PG_SSL: bool(false),
    PG_SSL_REJECT_UNAUTHORIZED: bool(true),
    JWT_SECRET: z.string().min(32),
    JWT_EXPIRES_IN: integer(3600, 60, 86400),
    JWT_ISSUER: z.string().default('mini-mirth'),
    JWT_AUDIENCE: z.string().default('mini-mirth-ui'),
    CONFIG_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
    CONFIG_ENCRYPTION_KEY_ID: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,32}$/)
      .default('current'),
    CONFIG_ENCRYPTION_PREVIOUS_KEYS: z.string().default('{}'),
    UI_ACCESS_TOKEN_SECONDS: integer(300, 60, 900),
    REFRESH_TOKEN_SECONDS: integer(604800, 300, 2592000),
    RETENTION_ENABLED: bool(false),
    INBOUND_IDEMPOTENCY_MODE: z.enum(['OPTIONAL', 'REQUIRED', 'DISABLED']).default('OPTIONAL'),
    IDEMPOTENCY_RETENTION_HOURS: integer(0, 0, 87600),
    MAX_ACTIVE_DELIVERY: integer(16, 1, 1000),
    MAX_DELIVERY_PER_DESTINATION: integer(2, 1, 100),
    CIRCUIT_FAILURE_THRESHOLD: integer(5, 1, 100),
    CIRCUIT_OPEN_SECONDS: integer(30, 1, 3600),
    MAX_ACTIVE_INBOUND: integer(32, 1, 1000),
    MAX_PENDING_MESSAGES: integer(10000, 1, 10000000),
    CORS_ORIGINS: z
      .string()
      .default(
        'http://localhost:5173,http://127.0.0.1:5173,http://localhost:9000,http://127.0.0.1:9000',
      ),
    MLLP_TLS_ENABLED: bool(false),
    MLLP_TLS_CERT_FILE: z.string().optional(),
    MLLP_TLS_KEY_FILE: z.string().optional(),
    MLLP_TLS_CA_FILE: z.string().optional(),
    MLLP_TLS_REQUIRE_CLIENT_CERT: bool(true),
    MLLP_PLAINTEXT_TRUSTED_NETWORK: bool(false),
    HL7_HOST: z.string().default('127.0.0.1'),
    HL7_PORT: integer(2575, 1, 65535),
    MLLP_MAX_CONNECTIONS: integer(64, 1, 10000),
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
    MASK_JSON_PATHS: z
      .string()
      .default(
        'patient,patientName,patientId,mrn,medicalRecordNumber,password,token,apiKey,authorization,secret',
      ),
    MASK_HL7_PATHS: z
      .string()
      .default('PID.2,PID.3,PID.4,PID.5,PID.6,PID.7,PID.8,PID.11,PID.13,PID.14,PID.19,OBX.5,NTE.3'),
    ALERT_WEBHOOK_URL: z.string().default(''),
    ALERT_COOLDOWN_SECONDS: integer(300, 1, 86400),
    ALERT_QUEUE_AGE_SECONDS: integer(300, 1, 86400),
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
  try {
    const ring = JSON.parse(e.CONFIG_ENCRYPTION_PREVIOUS_KEYS);
    if (
      !ring ||
      Array.isArray(ring) ||
      typeof ring !== 'object' ||
      Object.entries(ring).some(
        ([id, key]) =>
          id === e.CONFIG_ENCRYPTION_KEY_ID ||
          !/^[a-zA-Z0-9_-]{1,32}$/.test(id) ||
          typeof key !== 'string' ||
          !/^[a-fA-F0-9]{64}$/.test(key),
      )
    )
      throw new Error();
  } catch {
    throw new Error('Invalid encryption keyring configuration');
  }

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
  if (e.MLLP_TLS_ENABLED && (!e.MLLP_TLS_CERT_FILE || !e.MLLP_TLS_KEY_FILE || !e.MLLP_TLS_CA_FILE))
    throw new Error('MLLP TLS requires certificate, private key and CA files');
  if (
    e.NODE_ENV === 'production' &&
    e.HL7_ENABLED &&
    !e.MLLP_TLS_ENABLED &&
    !e.MLLP_PLAINTEXT_TRUSTED_NETWORK
  )
    throw new Error('Production MLLP requires TLS or an explicit isolated-network exception');
  return {
    production: e.NODE_ENV === 'production',
    server: {
      port: e.PORT,
      host: e.HOST,
      shutdownTimeout: e.SHUTDOWN_TIMEOUT_MS,
      payloadLimit: e.PAYLOAD_LIMIT_BYTES,
      trustProxy: list(e.TRUST_PROXY),
      maxActiveInbound: e.MAX_ACTIVE_INBOUND,
      maxPendingMessages: e.MAX_PENDING_MESSAGES,
    },
    database: {
      connectionString: e.DATABASE_URL,
      schema: e.PG_SCHEMA,
      database: decodeURIComponent(new URL(e.DATABASE_URL).pathname.slice(1)),
      caFile: e.PG_SSL_CA_FILE,
      ssl: e.PG_SSL ? { rejectUnauthorized: e.PG_SSL_REJECT_UNAUTHORIZED } : (false as const),
    },
    auth: {
      jwtSecret: e.JWT_SECRET,
      expiration: e.JWT_EXPIRES_IN,
      issuer: e.JWT_ISSUER,
      audience: e.JWT_AUDIENCE,
      publicRegistration: e.PUBLIC_REGISTRATION,
      uiExpiration: e.UI_ACCESS_TOKEN_SECONDS,
      refreshExpiration: e.REFRESH_TOKEN_SECONDS,
    },
    encryptionKey: e.CONFIG_ENCRYPTION_KEY,
    encryptionKeyId: e.CONFIG_ENCRYPTION_KEY_ID,
    previousEncryptionKeys: e.CONFIG_ENCRYPTION_PREVIOUS_KEYS,
    cors: { allowedOrigins: origins },
    hl7: {
      host: e.HL7_HOST,
      port: e.HL7_PORT,
      maxConnections: e.MLLP_MAX_CONNECTIONS,
      enabled: e.HL7_ENABLED,
      allowedIps: list(e.HL7_ALLOWED_IPS),
      tls: {
        enabled: e.MLLP_TLS_ENABLED,
        certFile: e.MLLP_TLS_CERT_FILE,
        keyFile: e.MLLP_TLS_KEY_FILE,
        caFile: e.MLLP_TLS_CA_FILE,
        requireClientCert: e.MLLP_TLS_REQUIRE_CLIENT_CERT,
      },
    },
    inbound: {
      baseUrl: e.INBOUND_BASE_URL,
      path: e.INBOUND_PATH.replace(/\/$/, ''),
      apiKey: e.INBOUND_API_KEY || '',
      idempotencyMode: e.INBOUND_IDEMPOTENCY_MODE,
      idempotencyRetentionHours: e.IDEMPOTENCY_RETENTION_HOURS,
    },
    transport: { timeout: e.REQUEST_TIMEOUT_MS, allowedHosts: list(e.OUTBOUND_ALLOWED_HOSTS) },
    scripts: {
      timeout: e.SCRIPT_TIMEOUT_MS,
      memoryMb: e.SCRIPT_MEMORY_MB,
      concurrency: e.SCRIPT_CONCURRENCY,
    },
    retention: {
      enabled: e.RETENTION_ENABLED,
      messages: e.MESSAGE_RETENTION_DAYS,
      audit: e.AUDIT_RETENTION_DAYS,
    },
    masking: { jsonPaths: list(e.MASK_JSON_PATHS), hl7Paths: list(e.MASK_HL7_PATHS) },
    alerts: {
      webhook: e.ALERT_WEBHOOK_URL,
      cooldownSeconds: e.ALERT_COOLDOWN_SECONDS,
      queueAgeSeconds: e.ALERT_QUEUE_AGE_SECONDS,
    },
    delivery: {
      maxActive: e.MAX_ACTIVE_DELIVERY,
      maxPerDestination: e.MAX_DELIVERY_PER_DESTINATION,
      failureThreshold: e.CIRCUIT_FAILURE_THRESHOLD,
      openSeconds: e.CIRCUIT_OPEN_SECONDS,
    },
    retryPollMs: e.RETRY_POLL_MS,
    logLevel: e.LOG_LEVEL,
  };
}
export const config = loadConfig(process.env);
