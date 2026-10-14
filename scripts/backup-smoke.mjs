import pg from 'pg';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL_REQUIRED');
const parsed = new URL(url);
if (
  !['localhost', '127.0.0.1'].includes(parsed.hostname) ||
  !/^mirth_disposable_[a-z0-9_]+$/.test(parsed.pathname.slice(1))
)
  throw new Error('BACKUP_SMOKE_REQUIRES_DISPOSABLE_DATABASE');
const restoreName = 'mirth_disposable_restore_' + Date.now();
const restore = new URL(url);
restore.pathname = '/' + restoreName;
const client = new pg.Client({ connectionString: url });
await client.connect();
const directory = await mkdtemp(path.join(tmpdir(), 'mirth-backup-smoke-'));
const env = {
  ...process.env,
  BACKUP_DATABASE_URL: url,
  BACKUP_DIRECTORY: directory,
  BACKUP_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  PGSSLMODE: 'disable',
  RESTORE_DISPOSABLE_CONFIRMED: 'true',
  PG_SCHEMA: 'public',
  PG_SSL: 'false',
  JWT_SECRET: 'synthetic-fixture-signing-secret-32-characters',
  CONFIG_ENCRYPTION_KEY: 'a'.repeat(64),
  CONFIG_ENCRYPTION_KEY_ID: 'current',
  CONFIG_ENCRYPTION_PREVIOUS_KEYS: '{}',
  HL7_ENABLED: 'false',
  ALERT_WEBHOOK_URL: '',
  LOG_LEVEL: 'silent',
};
async function run(args, overrides = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      env: { ...env, ...overrides },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let diagnostic = 'BACKUP_SMOKE_FAILED';
    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      if (text.includes('POSTGRES_TOOL_UNAVAILABLE')) diagnostic = 'POSTGRES_TOOL_UNAVAILABLE';
    });
    child.once('error', () => reject(new Error('BACKUP_SMOKE_TOOL_UNAVAILABLE')));
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(diagnostic))));
  });
}
let created = false;
try {
  await client.query('CREATE DATABASE "' + restoreName + '"');
  created = true;
  await run(['server/dist/scripts/backup.js', 'backup']);
  const backup = (await readdir(directory)).find((file) => file.endsWith('.dump.enc'));
  if (!backup) throw new Error('BACKUP_ARTIFACT_MISSING');
  await run(
    ['server/dist/scripts/backup.js', 'verify-restore', '--file', path.join(directory, backup)],
    { BACKUP_DATABASE_URL: restore.toString() },
  );
  console.info(
    'PASS: pg_dump encrypted backup + checksum + pg_restore single transaction + counts/encryption/message/login/health/readiness verification on disposable target',
  );
} finally {
  if (created) await client.query('DROP DATABASE "' + restoreName + '"');
  await client.end();
  await rm(directory, { recursive: true, force: true });
}
