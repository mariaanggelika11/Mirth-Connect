import pg from 'pg';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  inspectResetDatabase,
  lockResetDatabase,
  resetToSingleAdmin,
  operationalTables,
} from './development-reset-core.js';
import { restoreTarget } from '../utils/backup.js';
const option = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] || '' : '';
};
const url = process.env.RESET_VERIFY_DATABASE_URL || '';
try {
  restoreTarget(url, true);
} catch {
  console.error(JSON.stringify({ status: 'FAIL', code: 'LOCAL_DISPOSABLE_VERIFICATION_REQUIRED' }));
  process.exit(1);
}
const receiptPath = option('--receipt'),
  username = option('--keep-user');
const receipt = await readFile(receiptPath, 'utf8')
  .then((value) => JSON.parse(value))
  .catch(() => {
    console.error(JSON.stringify({ status: 'FAIL', code: 'VERIFICATION_RECEIPT_INVALID' }));
    process.exit(1);
  });
const schema = receipt.identity.schema;
Object.assign(process.env, {
  ENV_FILE: '/dev/null',
  DATABASE_URL: url,
  PG_SCHEMA: schema,
  PG_SSL: 'false',
  PG_SSL_CA_FILE: '',
  NODE_ENV: 'test',
  JWT_SECRET: 'synthetic-reset-verification-signing-secret-32-characters',
  CONFIG_ENCRYPTION_KEY: 'a'.repeat(64),
  CONFIG_ENCRYPTION_KEY_ID: 'current',
  CONFIG_ENCRYPTION_PREVIOUS_KEYS: '{}',
  HL7_ENABLED: 'false',
  ALERT_WEBHOOK_URL: '',
  RETENTION_ENABLED: 'false',
  LOG_LEVEL: 'silent',
  TRUST_PROXY: '',
});
const client = new pg.Client({
  connectionString: url,
  options: '-c timezone=UTC -c search_path=' + schema,
  connectionTimeoutMillis: 10000,
  statement_timeout: 30000,
});
const passed: string[] = [];
try {
  await client.connect();
  const restored = await inspectResetDatabase(client, schema);
  assert.deepEqual(restored.counts, receipt.source.counts);
  assert.deepEqual(restored.fingerprints, receipt.source.fingerprints);
  passed.push(
    'Restored counts and all table fingerprints match the exact pre-reset source snapshot',
  );
  await client.query('BEGIN');
  try {
    await assert.rejects(
      resetToSingleAdmin(client, schema, 'missing-synthetic-user'),
      /EXISTING_BCRYPT_ADMIN/,
    );
  } finally {
    await client.query('ROLLBACK');
  }
  assert.deepEqual(
    (await inspectResetDatabase(client, schema)).fingerprints,
    restored.fingerprints,
  );
  passed.push('Missing retained administrator refuses reset without data changes');
  await client.query('BEGIN');
  try {
    await client.query('CREATE SCHEMA mirth_test_reset_foreign');
    await client.query(
      'CREATE TABLE mirth_test_reset_foreign.child(user_id bigint REFERENCES "Users"(id) ON DELETE CASCADE)',
    );
    await assert.rejects(inspectResetDatabase(client, schema), /EXTERNAL_DEPENDENCY/);
  } finally {
    await client.query('ROLLBACK');
  }
  passed.push('Foreign-schema cascading dependency is rejected');
  await client.query('BEGIN');
  try {
    await client.query('INSERT INTO "SchemaMigrations"(version) VALUES(99)');
    await assert.rejects(inspectResetDatabase(client, schema), /UNSUPPORTED_RESET_SCHEMA_VERSION/);
  } finally {
    await client.query('ROLLBACK');
  }
  passed.push('Future schema cannot be downgraded by reset');
  await client.query('BEGIN');
  try {
    const channel = (await client.query('SELECT id FROM "Channels" LIMIT 1')).rows[0];
    assert.ok(channel, 'Pre-reset fixture needs an existing channel');
    await client.query(
      `INSERT INTO "Messages"(channel_id,direction,message_type,original_payload,status) VALUES($1,'IN','JSON','{}','IN-PROCESS')`,
      [channel.id],
    );
    await assert.rejects(
      resetToSingleAdmin(client, schema, username),
      /ACTIVE_WORK_PREVENTS_RESET/,
    );
  } finally {
    await client.query('ROLLBACK');
  }
  passed.push('Active processing refuses deletion');
  await client.query('BEGIN');
  try {
    const failing = {
      query: (sql: string, values?: unknown[]) =>
        sql.startsWith('DELETE FROM "Users"')
          ? Promise.reject(new Error('SYNTHETIC_DELETE_FAILURE'))
          : client.query(sql, values),
    } as unknown as pg.Client;
    await assert.rejects(resetToSingleAdmin(failing, schema, username), /SYNTHETIC_DELETE_FAILURE/);
  } finally {
    await client.query('ROLLBACK');
  }
  assert.deepEqual(
    (await inspectResetDatabase(client, schema)).fingerprints,
    restored.fingerprints,
  );
  passed.push(
    'Injected failure after TRUNCATE rolls back both schema migration and all data deletion',
  );
  await client.query('BEGIN');
  try {
    await client.query(
      'UPDATE "Channels" SET name=name||$1 WHERE id=(SELECT id FROM "Channels" LIMIT 1)',
      [' synthetic change'],
    );
    assert.notDeepEqual(
      (await inspectResetDatabase(client, schema)).fingerprints,
      restored.fingerprints,
    );
  } finally {
    await client.query('ROLLBACK');
  }
  passed.push('Fingerprint catches source changes even when row counts are unchanged');
  await client.query('BEGIN');
  await lockResetDatabase(client, schema, restored.tables, 'ACCESS EXCLUSIVE');
  const result = await resetToSingleAdmin(client, schema, username);
  await client.query('COMMIT');
  assert.deepEqual(result.schemaVersions, [1, 2, 3, 4, 5, 6]);
  assert.equal(result.counts.Users, 1);
  assert.ok(operationalTables.every((t) => result.counts[t] === 0));
  assert.equal(result.passwordHashPreserved, true);
  passed.push(
    'Full schema 1 to 6 upgrade and cleanup retain exactly the chosen administrator and unchanged password hash',
  );
  const clean = await inspectResetDatabase(client, schema);
  await client.query('BEGIN');
  await lockResetDatabase(client, schema, clean.tables, 'ACCESS EXCLUSIVE');
  await resetToSingleAdmin(client, schema, username);
  await client.query('COMMIT');
  assert.deepEqual((await inspectResetDatabase(client, schema)).fingerprints, clean.fingerprints);
  passed.push('Repeated migration/reset remains consistent without account changes');
  const bcrypt = (await import('bcrypt')).default,
    request = (await import('supertest')).default;
  const app = (await import('../app.js')).default;
  const { signToken } = await import('../services/auth.services.js');
  const password = randomUUID() + randomUUID(),
    synthetic = 'reset-fixture-' + randomUUID();
  await client.query('INSERT INTO "Users"(username,name,password_hash,role) VALUES($1,$2,$3,$4)', [
    synthetic,
    'Synthetic login verification',
    await bcrypt.hash(password, 12),
    'VIEWER',
  ]);
  const login = await request(app)
    .post('/api/auth/browser/login')
    .send({ username: synthetic, password });
  assert.equal(login.status, 200);
  assert.ok(login.headers['set-cookie']);
  assert.equal(
    (
      await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer ' + login.body.token)
    ).status,
    200,
  );
  const admin = await request(app)
    .get('/api/auth/me')
    .set(
      'Authorization',
      'Bearer ' +
        signToken({ id: Number(result.userId), name: 'Retained administrator', role: 'ADMIN' }),
    );
  assert.equal(admin.status, 200);
  assert.equal(admin.body.data.role, 'ADMIN');
  assert.equal((await request(app).get('/health')).status, 200);
  assert.equal((await request(app).get('/ready')).status, 200);
  const { closeConnection } = await import('../config/db.js');
  await closeConnection();
  await client.query('BEGIN');
  await lockResetDatabase(client, schema, clean.tables, 'ACCESS EXCLUSIVE');
  await resetToSingleAdmin(client, schema, username);
  await client.query('COMMIT');
  assert.deepEqual((await inspectResetDatabase(client, schema)).fingerprints, clean.fingerprints);
  passed.push(
    'Synthetic password/browser login, retained ADMIN authentication, health/readiness succeed; synthetic account/session/audit removed',
  );
  receipt.restoreVerified = true;
  receipt.restoreVerification = {
    database: new URL(url).pathname.slice(1),
    verifiedAt: new Date().toISOString(),
    checks: passed,
    result,
  };
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  console.info(
    JSON.stringify({
      status: 'PASS',
      checks: passed.length,
      details: passed,
      keptUsername: username,
      existingPasswordLogin:
        'NOT TESTED — existing password was not requested; exact stored hash preserved',
    }),
  );
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(
    JSON.stringify({
      status: 'FAIL',
      completedChecks: passed.length,
      code:
        error instanceof Error && /^[A-Z_0-9]{1,100}$/.test(error.message)
          ? error.message
          : 'RESET_REHEARSAL_FAILED',
    }),
  );
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
