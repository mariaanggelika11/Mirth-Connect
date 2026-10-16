import type { AddressInfo } from 'node:net';
// Opt-in real PostgreSQL validation. Uses an isolated, newly created mirth_test_* schema.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { signToken } from '../src/services/auth.services.js';
import { randomUUID, createHash } from 'node:crypto';
import http from 'node:http';
import pg from 'pg';
import { encrypt, decrypt } from '../src/utils/secrets.js';
import { rotateSecrets } from '../src/services/rotation.services.js';
import {
  retryTick,
  retentionTick,
  idempotencyCleanupTick,
} from '../src/services/worker.services.js';
import { acquireDelivery, releaseDelivery } from '../src/services/circuitBreaker.services.js';
import {
  processInboundMessage,
  resendMessage as resendStoredMessage,
} from '../src/services/messageProcessor.services.js';
import { sample } from './fixtures.js';
import { compileFieldMapping, readFieldMapping } from '../src/utils/fieldMapping.js';
import { compileSimpleCondition } from '../src/utils/simpleCondition.js';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { config } from '../src/config/env.js';
import { getConnection, closeConnection, withTransaction } from '../src/config/db.js';
import app from '../src/app.js';
if (!/^mirth_test_[a-z0-9_]+$/.test(config.database.schema))
  throw new Error(
    'Live PostgreSQL tests require PG_SCHEMA=mirth_test_<unique suffix>; public is never used',
  );
const control = new pg.Pool({
  connectionString: config.database.connectionString,
  ssl: config.database.ssl,
  connectionTimeoutMillis: 10000,
});
let schemaCreated = false;
let pool: Awaited<ReturnType<typeof getConnection>>;
let received = 0;
const receivedBodies: string[] = [];
const suffix = randomUUID();
const username = 'qa-' + suffix;
const receiver = http.createServer((req, res) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk: string) => {
    body += chunk;
  });
  req.on('end', () => {
    received++;
    receivedBodies.push(body);
    res.setHeader('Content-Type', 'application/json');
    res.end('{"ok":true}');
  });
});
let port: number;
before(async () => {
  await control.query('CREATE SCHEMA "' + config.database.schema + '"');
  schemaCreated = true;
  pool = await getConnection();
  await withTransaction(async (tx) => {
    await tx
      .request()
      .batch(await readFile(new URL('../migrations/001_engine.sql', import.meta.url), 'utf8'));
    await tx
      .request()
      .batch(await readFile(new URL('../migrations/002_hardening.sql', import.meta.url), 'utf8'));
    await tx
      .request()
      .batch(
        await readFile(new URL('../migrations/003_delivery_controls.sql', import.meta.url), 'utf8'),
      );
    await tx
      .request()
      .batch(
        await readFile(
          new URL('../migrations/004_operational_alerts.sql', import.meta.url),
          'utf8',
        ),
      );
    await tx
      .request()
      .batch(
        await readFile(
          new URL('../migrations/005_operational_controls.sql', import.meta.url),
          'utf8',
        ),
      );
    await tx
      .request()
      .batch(
        await readFile(
          new URL('../migrations/006_delivery_http_status.sql', import.meta.url),
          'utf8',
        ),
      );
    await tx
      .request()
      .batch(
        await readFile(new URL('../migrations/007_delivery_timing.sql', import.meta.url), 'utf8'),
      );
  });
  const userId = (
    await pool
      .request()
      .input('username', username)
      .input('hash', await bcrypt.hash('qa-password-with-12-characters', 12))
      .query(
        "INSERT INTO \"Users\"(username,name,password_hash,role) VALUES(@username,'QA admin',@hash,'ADMIN') RETURNING id",
      )
  ).recordset[0].id;
  assert.ok(Number.isSafeInteger(userId));
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  port = (receiver.address() as AddressInfo).port;
});
let channelId: number | undefined;
let token: string;
after(async () => {
  if (receiver.listening) await new Promise<void>((resolve) => receiver.close(() => resolve()));
  await closeConnection();
  if (schemaCreated) await control.query('DROP SCHEMA "' + config.database.schema + '" CASCADE');
  await control.end();
});
test('real PostgreSQL: authentication → atomic channel create → source credential → inbound → destination → monitor → logout', async () => {
  const login = await request(app)
    .post('/api/auth/login')
    .send({ username, password: 'qa-password-with-12-characters' });
  assert.equal(login.status, 200);
  token = login.body.token;
  const payload = {
    name: 'QA ' + suffix,
    source: { type: 'HTTP', inboundDataType: 'JSON' },
    destinations: [
      {
        name: 'QA receiver',
        type: 'REST',
        endpoint: `http://127.0.0.1:${port}`,
        outboundDataType: 'JSON',
        retryEnabled: true,
      },
    ],
  };
  const created = await request(app)
    .post('/api/channel')
    .set('Authorization', 'Bearer ' + token)
    .send(payload);
  assert.equal(created.status, 201);
  channelId = created.body.channelId;
  assert.equal(
    (
      await request(app)
        .put(`/api/channel/${channelId}/status`)
        .set('Authorization', 'Bearer ' + token)
        .send({ status: 'RUNNING' })
    ).status,
    200,
  );
  const credential = await request(app)
    .put(`/api/channel/${channelId}/credential`)
    .set('Authorization', 'Bearer ' + token);
  assert.equal(credential.status, 200);
  const inbound = await request(app)
    .post(`${config.inbound.path}/${channelId}`)
    .set('X-API-Key', credential.body.data.apiKey)
    .send({ qa: 'synthetic data' });
  assert.equal(inbound.status, 200);
  assert.equal(inbound.body.result.inboundStatus, 'SUCCESS');
  const monitor = await request(app)
    .get(`/api/message?channelId=${channelId}&pageSize=1`)
    .set('Authorization', 'Bearer ' + token);
  assert.equal(monitor.status, 200);
  assert.equal(monitor.body.data.length, 1);
  assert.equal(monitor.body.pagination.total, 1);
  assert.equal(monitor.body.data[0].originalPayload, undefined);
  const detail = await request(app)
    .get('/api/message/' + monitor.body.data[0].id)
    .set('Authorization', 'Bearer ' + token);
  assert.equal(detail.body.data.payloadAllowed, true);
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const overview = await request(app)
    .get('/api/message/stats?dateFrom=' + encodeURIComponent(midnight.toISOString()))
    .set('Authorization', 'Bearer ' + token);
  assert.equal(overview.status, 200);
  assert.equal(overview.body.messagesToday, 1);
  assert.equal(overview.body.queuedMessages, 0);
  assert.equal(overview.body.deadLetterMessages, 0);
  const both = await request(app)
    .get(`/api/message?channelId=${channelId}&direction=ALL`)
    .set('Authorization', 'Bearer ' + token);
  assert.equal(both.status, 200);
  assert.equal(both.body.pagination.total, 2);
  const errors = await request(app)
    .get(`/api/message?channelId=${channelId}&direction=ALL&statusGroup=errors`)
    .set('Authorization', 'Bearer ' + token);
  assert.equal(errors.status, 200);
  assert.equal(errors.body.pagination.total, 0);
  const pending = await request(app)
    .get(`/api/message?channelId=${channelId}&direction=OUT&statusGroup=pending`)
    .set('Authorization', 'Bearer ' + token);
  assert.equal(pending.status, 200);
  assert.equal(pending.body.pagination.total, 0);
  assert.equal(detail.body.data.destinationLogs[0].status, 'OUT-SENT');
  assert.equal(
    (
      await request(app)
        .post('/api/auth/logout')
        .set('Authorization', 'Bearer ' + token)
    ).status,
    200,
  );
  assert.equal(
    (
      await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer ' + token)
    ).status,
    401,
  );
});
test('real PostgreSQL: failed related write rolls back all channel changes', async () => {
  const name = 'rollback-' + suffix;
  await assert.rejects(
    withTransaction(async (tx) => {
      const id = (
        await tx
          .request()
          .input('name', name)
          .query(
            "INSERT INTO \"Channels\"(name,status,source_type,source_endpoint,inbound_data_type) VALUES(@name,'STOPPED','HTTP','','JSON') RETURNING id",
          )
      ).recordset[0].id;
      await tx
        .request()
        .input('id', id)
        .query(
          "INSERT INTO \"Destinations\"(channel_id,name,type,endpoint,outbound_data_type) VALUES(@id,NULL,'REST','http://localhost','JSON')",
        );
    }),
  );
  assert.equal(
    (await pool.request().input('name', name).query('SELECT id FROM "Channels" WHERE name=@name'))
      .recordset.length,
    0,
  );
});

test('real PostgreSQL: two schedulers claim one queued delivery exactly once', async () => {
  const outbound = (
    await pool
      .request()
      .input('channel', channelId)
      .query(
        'SELECT id,inbound_message_id FROM "Messages" WHERE channel_id=@channel AND direction=\'OUT\'',
      )
  ).recordset[0];
  await pool
    .request()
    .input('id', outbound.id)
    .query(
      `UPDATE "Messages" SET status='QUEUED',next_retry_at=CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id=@id`,
    );
  const count = received;
  await Promise.all([retryTick(), retryTick()]);
  assert.equal(received - count, 1);
  const row = (
    await pool
      .request()
      .input('id', outbound.id)
      .query('SELECT status,retry_count FROM "Messages" WHERE id=@id')
  ).recordset[0];
  assert.equal(row.status, 'OUT-SENT');
  assert.equal(row.retry_count, 1);
});
test('real PostgreSQL: migration repeats without duplicate versions or data loss', async () => {
  const count = (await pool.request().query('SELECT count(*) total FROM "Channels"')).recordset[0]
    .total;
  await withTransaction(async (tx) => {
    await tx
      .request()
      .batch(await readFile(new URL('../migrations/001_engine.sql', import.meta.url), 'utf8'));
    await tx
      .request()
      .batch(await readFile(new URL('../migrations/002_hardening.sql', import.meta.url), 'utf8'));
    await tx
      .request()
      .batch(
        await readFile(new URL('../migrations/003_delivery_controls.sql', import.meta.url), 'utf8'),
      );
    await tx
      .request()
      .batch(
        await readFile(
          new URL('../migrations/004_operational_alerts.sql', import.meta.url),
          'utf8',
        ),
      );
    await tx
      .request()
      .batch(
        await readFile(
          new URL('../migrations/005_operational_controls.sql', import.meta.url),
          'utf8',
        ),
      );
    await tx
      .request()
      .batch(
        await readFile(
          new URL('../migrations/006_delivery_http_status.sql', import.meta.url),
          'utf8',
        ),
      );
    await tx
      .request()
      .batch(
        await readFile(new URL('../migrations/007_delivery_timing.sql', import.meta.url), 'utf8'),
      );
  });
  assert.equal(
    (await pool.request().query('SELECT count(*) total FROM "SchemaMigrations"')).recordset[0]
      .total,
    7,
  );
  assert.equal(
    (await pool.request().query('SELECT count(*) total FROM "Channels"')).recordset[0].total,
    count,
  );
});
test('real PostgreSQL: concurrent duplicate HL7 creates only one inbound reservation', async () => {
  const id = (
    await pool
      .request()
      .query(
        `INSERT INTO "Channels"(name,status,source_type,inbound_data_type) VALUES('QA dedupe','RUNNING','HTTP','HL7V2') RETURNING id`,
      )
  ).recordset[0].id;
  const results = await Promise.allSettled([
    processInboundMessage(id, sample),
    processInboundMessage(id, sample),
  ]);
  assert.ok(results.some((r) => r.status === 'fulfilled'));
  assert.equal(
    (
      await pool
        .request()
        .input('id', id)
        .query('SELECT count(*) total FROM "Messages" WHERE channel_id=@id AND direction=\'IN\'')
    ).recordset[0].total,
    1,
  );
});
test('real PostgreSQL: retention removes resolved history and preserves queued work', async () => {
  await pool
    .request()
    .input('channel', channelId)
    .query(
      `UPDATE "Messages" SET created_at=CURRENT_TIMESTAMP - INTERVAL '4000 days' WHERE channel_id=@channel`,
    );
  await pool
    .request()
    .input('channel', channelId)
    .query(
      `UPDATE "Messages" SET status='QUEUED',next_retry_at=CURRENT_TIMESTAMP + INTERVAL '1 day' WHERE channel_id=@channel AND direction='OUT'`,
    );
  await retentionTick();
  assert.equal(
    (
      await pool
        .request()
        .input('channel', channelId)
        .query('SELECT count(*) total FROM "Messages" WHERE channel_id=@channel')
    ).recordset[0].total,
    2,
  );
  await pool
    .request()
    .input('channel', channelId)
    .query(`UPDATE "Messages" SET status='OUT-SENT' WHERE channel_id=@channel AND direction='OUT'`);
  await retentionTick();
  assert.equal(
    (
      await pool
        .request()
        .input('channel', channelId)
        .query('SELECT count(*) total FROM "Messages" WHERE channel_id=@channel')
    ).recordset[0].total,
    0,
  );
});

// Each request uses a synthetic fixture, with no production data or credentials.
test('real PostgreSQL: concurrent HTTP idempotency and payload conflict', async () => {
  const id = (
    await pool
      .request()
      .query(
        `INSERT INTO "Channels"(name,status,source_type,inbound_data_type) VALUES('Synthetic idempotency','RUNNING','HTTP','JSON') RETURNING id`,
      )
  ).recordset[0].id;
  const payload = { fixture: 'synthetic' };
  const results = await Promise.allSettled([
    processInboundMessage(id, payload, 'synthetic-a', 'same-key'),
    processInboundMessage(id, payload, 'synthetic-b', 'same-key'),
  ]);
  assert.ok(results.some((r) => r.status === 'fulfilled'));
  const rows = (
    await pool
      .request()
      .input('id', id)
      .query('SELECT count(*) total FROM "Messages" WHERE channel_id=@id')
  ).recordset[0];
  assert.equal(rows.total, 1);
  await assert.rejects(
    processInboundMessage(id, { fixture: 'different' }, 'synthetic-c', 'same-key'),
    (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === 'IDEMPOTENCY_CONFLICT',
  );
});
test('real PostgreSQL: draft, competing publish and rollback preserve history', async () => {
  const login = await request(app)
    .post('/api/auth/login')
    .send({ username, password: 'qa-password-with-12-characters' });
  const auth = 'Bearer ' + login.body.token;
  const initial = {
    name: 'Synthetic revision',
    source: { type: 'HTTP', inboundDataType: 'JSON' },
    destinations: [],
    changeSummary: 'Initial synthetic fixture',
  };
  const created = await request(app).post('/api/channel').set('Authorization', auth).send(initial);
  assert.equal(created.status, 201);
  const id = created.body.channelId;
  const draft = await request(app)
    .put('/api/channel/' + id)
    .set('Authorization', auth)
    .send({ ...initial, name: 'Changed revision', changeSummary: 'Synthetic draft' });
  assert.equal(draft.status, 200);
  assert.equal(draft.body.draft, true);
  assert.equal(
    (await pool.request().input('id', id).query('SELECT name FROM "Channels" WHERE id=@id'))
      .recordset[0].name,
    'Synthetic revision',
  );
  const endpoint = '/api/channel/' + id + '/revisions/' + draft.body.revision + '/publish';
  const publishes = await Promise.all([
    request(app)
      .post(endpoint)
      .set('Authorization', auth)
      .send({ expectedActiveRevision: 1, changeSummary: 'Publish synthetic draft' }),
    request(app)
      .post(endpoint)
      .set('Authorization', auth)
      .send({ expectedActiveRevision: 1, changeSummary: 'Competing synthetic publish' }),
  ]);
  assert.deepEqual(publishes.map((r) => r.status).sort(), [200, 409]);
  const active = publishes.find((r) => r.status === 200)!.body.activeRevision;
  const rollback = await request(app)
    .post('/api/channel/' + id + '/revisions/1/rollback')
    .set('Authorization', auth)
    .send({ expectedActiveRevision: active, changeSummary: 'Rollback synthetic fixture' });
  assert.equal(rollback.status, 200);
  assert.equal(
    (await pool.request().input('id', id).query('SELECT name FROM "Channels" WHERE id=@id'))
      .recordset[0].name,
    'Synthetic revision',
  );
  assert.equal(
    (
      await pool
        .request()
        .input('id', id)
        .query('SELECT count(*) total FROM "ChannelRevisions" WHERE channel_id=@id')
    ).recordset[0].total,
    4,
  );
});

test('real PostgreSQL: browser refresh rotation and reuse revoke access session', async () => {
  const login = await request(app)
    .post('/api/auth/browser/login')
    .send({ username, password: 'qa-password-with-12-characters' });
  assert.equal(login.status, 200);
  const cookies = login.headers['set-cookie'] as unknown as string[];
  const cookieHeader = cookies.map((v) => v.split(';')[0]).join('; ');
  const csrf = login.body.csrfToken;
  const refresh = await request(app)
    .post('/api/auth/browser/refresh')
    .set('Cookie', cookieHeader)
    .set('X-CSRF-Token', csrf);
  assert.equal(refresh.status, 200);
  assert.equal(
    (
      await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer ' + refresh.body.token)
    ).status,
    200,
  );
  const reused = await request(app)
    .post('/api/auth/browser/refresh')
    .set('Cookie', cookieHeader)
    .set('X-CSRF-Token', csrf);
  assert.equal(reused.status, 401);
  assert.equal(
    (
      await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer ' + refresh.body.token)
    ).status,
    401,
  );
});

test('real PostgreSQL: separate workers deduplicate persisted alert and admin acknowledges', async () => {
  await pool
    .request()
    .query(
      `INSERT INTO "Channels"(name,status,source_type,inbound_data_type) VALUES('Synthetic alert fixture','ERROR','HTTP','JSON')`,
    );
  let notifications = 0;
  const alertReceiver = http.createServer((_req, res) => {
    notifications++;
    res.end('ok');
  });
  await new Promise<void>((resolve) => alertReceiver.listen(0, '127.0.0.1', resolve));
  const endpoint = 'http://127.0.0.1:' + (alertReceiver.address() as AddressInfo).port;
  const run = () =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          '--input-type=module',
          '-e',
          `import {alertTick} from './server/src/services/alert.services.ts';import {closeConnection} from './server/src/config/db.ts';await alertTick();await closeConnection();`,
        ],
        { env: { ...process.env, ALERT_WEBHOOK_URL: endpoint }, stdio: 'ignore' },
      );
      child.once('error', () => reject(new Error('SYNTHETIC_ALERT_WORKER_FAILED')));
      child.once('exit', (code) =>
        code === 0 ? resolve() : reject(new Error('SYNTHETIC_ALERT_WORKER_FAILED')),
      );
    });
  try {
    await Promise.all([run(), run()]);
    assert.equal(notifications, 1);
    const row = (
      await pool
        .request()
        .query(`SELECT state,delivery_pending FROM "OperationalAlerts" WHERE code='CHANNEL_ERROR'`)
    ).recordset[0];
    assert.equal(row.state, 'OPEN');
    assert.equal(row.delivery_pending, false);
    const user = (
      await pool
        .request()
        .input('name', username)
        .query('SELECT id,name,role FROM "Users" WHERE username=@name')
    ).recordset[0];
    const acknowledged = await request(app)
      .post('/api/alerts/CHANNEL_ERROR/acknowledge')
      .set(
        'Authorization',
        'Bearer ' + signToken({ id: user.id, name: user.name, role: user.role }),
      );
    assert.equal(acknowledged.status, 200);
    assert.equal(
      (
        await pool
          .request()
          .query(`SELECT state FROM "OperationalAlerts" WHERE code='CHANNEL_ERROR'`)
      ).recordset[0].state,
      'ACKNOWLEDGED',
    );
  } finally {
    await new Promise<void>((resolve) => alertReceiver.close(() => resolve()));
  }
});

test('real PostgreSQL: retired destination cannot be manually resent', async () => {
  const id = (
    await pool
      .request()
      .query(
        `INSERT INTO "Channels"(name,status,source_type,inbound_data_type) VALUES('Synthetic retired sender','RUNNING','HTTP','JSON') RETURNING id`,
      )
  ).recordset[0].id;
  const dest = (
    await pool
      .request()
      .input('id', id)
      .input('endpoint', encrypt('http://127.0.0.1:' + port))
      .query(
        `INSERT INTO "Destinations"(channel_id,name,type,endpoint,outbound_data_type,is_enabled,is_deleted) VALUES(@id,'Synthetic retired destination','REST',@endpoint,'JSON',false,true) RETURNING *`,
      )
  ).recordset[0];
  const message = (
    await pool
      .request()
      .input('id', id)
      .input('dest', dest.id)
      .input('snapshot', encrypt(JSON.stringify(dest)))
      .query(
        `INSERT INTO "Messages"(channel_id,destination_id,direction,message_type,original_payload,transformed_payload,status,transport_config,correlation_id) VALUES(@id,@dest,'OUT','JSON','{}','{}','DEAD_LETTER',@snapshot,'synthetic-retired') RETURNING id`,
      )
  ).recordset[0];
  const before = received;
  await assert.rejects(resendStoredMessage(message.id), /Resend requires/);
  assert.equal(received, before);
  assert.equal(
    (
      await pool
        .request()
        .input('id', message.id)
        .query('SELECT status FROM "Messages" WHERE id=@id')
    ).recordset[0].status,
    'DEAD_LETTER',
  );
});
test('real PostgreSQL: resolving dead letter preserves evidence and assignment but clears open metric', async () => {
  const message = (
    await pool
      .request()
      .query(
        `SELECT id FROM "Messages" WHERE direction='OUT' AND status='DEAD_LETTER' ORDER BY id DESC LIMIT 1`,
      )
  ).recordset[0];
  const user = (
    await pool
      .request()
      .input('name', username)
      .query('SELECT id,name,role FROM "Users" WHERE username=@name')
  ).recordset[0];
  const auth = 'Bearer ' + signToken({ id: user.id, name: user.name, role: user.role });
  const endpoint = '/api/message/' + message.id + '/reconciliation';
  assert.equal(
    (
      await request(app).put(endpoint).set('Authorization', auth).send({
        state: 'IN_REVIEW',
        note: 'Synthetic operator review',
        category: 'TRANSPORT',
        assignedTo: user.id,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(app).put(endpoint).set('Authorization', auth).send({
        state: 'RESOLVED',
        note: 'Synthetic receiving-system reconciliation completed',
        category: 'TRANSPORT',
      })
    ).status,
    200,
  );
  const state = (
    await pool
      .request()
      .input('id', message.id)
      .query('SELECT state,assigned_to FROM "DeadLetterCases" WHERE message_id=@id')
  ).recordset[0];
  assert.equal(state.state, 'RESOLVED');
  assert.equal(state.assigned_to, user.id);
  assert.equal(
    (
      await pool
        .request()
        .input('id', message.id)
        .query('SELECT status FROM "Messages" WHERE id=@id')
    ).recordset[0].status,
    'DEAD_LETTER',
  );
  const metrics = await request(app).get('/metrics').set('Authorization', auth);
  assert.equal(metrics.status, 200);
  assert.match(metrics.text, /mirth_dead_letter_open 0/);
  assert.match(metrics.text, /mirth_dead_letter 1/);
});

async function syntheticAdminAuth() {
  const user = (
    await pool
      .request()
      .input('name', username)
      .query('SELECT id,name,role FROM "Users" WHERE username=@name')
  ).recordset[0];
  return 'Bearer ' + signToken({ id: user.id, name: user.name, role: user.role });
}
test('real PostgreSQL: concurrent successor drafts preserve private configuration and stored dry-run has no side effects', async () => {
  const auth = await syntheticAdminAuth();
  const initial = {
    name: 'Synthetic editable draft',
    source: { type: 'HTTP', inboundDataType: 'JSON' },
    processingScript: 'msg.processed = true;',
    destinations: [
      {
        name: 'Synthetic private sender',
        type: 'REST',
        endpoint: `http://user:synthetic-secret@127.0.0.1:${port}/send?token=synthetic-token`,
        outboundDataType: 'JSON',
        deliveryPolicy: { failureThreshold: 2, openSeconds: 45, maxConcurrency: 1 },
      },
    ],
  };
  const create = await request(app).post('/api/channel').set('Authorization', auth).send(initial);
  assert.equal(create.status, 201);
  const id = create.body.channelId;
  const draft = await request(app)
    .put('/api/channel/' + id)
    .set('Authorization', auth)
    .send({ ...initial, changeSummary: 'Synthetic private draft' });
  assert.equal(draft.status, 200);
  const endpoint = `/api/channel/${id}/revisions/${draft.body.revision}`;
  const detail = await request(app).get(endpoint).set('Authorization', auth);
  assert.equal(detail.status, 200);
  assert.ok(!JSON.stringify(detail.body).includes('synthetic-secret'));
  const patch = {
    expectedChecksum: detail.body.checksum,
    changeSummary: 'Synthetic successor edit',
    patch: { name: 'Successor synthetic draft', destinations: [{ index: 0, timeoutMs: 4321 }] },
  };
  const edits = await Promise.all([
    request(app).patch(endpoint).set('Authorization', auth).send(patch),
    request(app).patch(endpoint).set('Authorization', auth).send(patch),
  ]);
  assert.deepEqual(edits.map((r) => r.status).sort(), [200, 409]);
  const successor = edits.find((r) => r.status === 200)!.body.revision;
  const row = (
    await pool
      .request()
      .input('id', id)
      .input('revision', successor)
      .query(
        'SELECT configuration FROM "ChannelRevisions" WHERE channel_id=@id AND revision=@revision',
      )
  ).recordset[0];
  const stored = JSON.parse(decrypt(row.configuration));
  assert.equal(stored.destinations[0].endpoint, initial.destinations[0].endpoint);
  assert.equal(stored.processingScript, initial.processingScript);
  assert.equal(
    (
      await pool
        .request()
        .input('id', id)
        .query('SELECT name,active_revision FROM "Channels" WHERE id=@id')
    ).recordset[0].name,
    initial.name,
  );
  const before = received;
  const run = await request(app)
    .post(`/api/channel/${id}/revisions/${successor}/dry-run`)
    .set('Authorization', auth)
    .send({ payload: { patientName: 'Synthetic Patient', fixture: true } });
  assert.equal(run.status, 200);
  assert.equal(run.body.results[0].finalPayload.processed, true);
  assert.equal(run.body.results[0].finalPayload.patientName, '[REDACTED]');
  const probe = await request(app)
    .post(`/api/channel/${id}/revisions/${successor}/destinations/0/test-connection`)
    .set('Authorization', auth)
    .send({});
  assert.equal(probe.status, 200);
  assert.equal(probe.body.reachable, true);
  assert.equal(received, before);
  assert.equal(
    (
      await pool
        .request()
        .input('id', id)
        .query('SELECT count(*) total FROM "Messages" WHERE channel_id=@id')
    ).recordset[0].total,
    0,
  );
  const publish = await request(app)
    .post(`/api/channel/${id}/revisions/${successor}/publish`)
    .set('Authorization', auth)
    .send({ expectedActiveRevision: 1, changeSummary: 'Publish successor synthetic draft' });
  assert.equal(publish.status, 200);
  const policy = (
    await pool
      .request()
      .input('id', id)
      .query('SELECT delivery_policy FROM "Destinations" WHERE channel_id=@id AND is_deleted=false')
  ).recordset[0].delivery_policy;
  assert.deepEqual(policy, initial.destinations[0].deliveryPolicy);
});
test('real PostgreSQL: canonical hash accepts reordered legacy JSON and bounded TTL releases reservation without deleting evidence', async () => {
  const id = (
    await pool
      .request()
      .query(
        `INSERT INTO "Channels"(name,status,source_type,inbound_data_type) VALUES('Synthetic canonical TTL','RUNNING','HTTP','JSON') RETURNING id`,
      )
  ).recordset[0].id;
  const original = { z: 1, a: { y: 2, x: 3 } },
    reordered = { a: { x: 3, y: 2 }, z: 1 };
  const first = await processInboundMessage(id, original, 'synthetic-legacy', 'legacy-order');
  await pool
    .request()
    .input('id', first.inboundMessageId)
    .input('hash', createHash('sha256').update(JSON.stringify(original)).digest('hex'))
    .query('UPDATE "Messages" SET request_hash=@hash,canonical_request_hash=NULL WHERE id=@id');
  const duplicate = await processInboundMessage(
    id,
    reordered,
    'synthetic-reordered',
    'legacy-order',
  );
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.inboundMessageId, first.inboundMessageId);
  const previous = config.inbound.idempotencyRetentionHours;
  config.inbound.idempotencyRetentionHours = 1;
  try {
    const initial = await processInboundMessage(id, original, 'synthetic-ttl-1', 'ttl-key');
    const stored = (
      await pool
        .request()
        .input('id', initial.inboundMessageId)
        .query('SELECT dedupe_expires_at,idempotency_key_hash FROM "Messages" WHERE id=@id')
    ).recordset[0];
    assert.ok(stored.dedupe_expires_at);
    assert.ok(stored.idempotency_key_hash);
    await pool
      .request()
      .input('id', initial.inboundMessageId)
      .query(
        `UPDATE "Messages" SET dedupe_expires_at=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE id=@id`,
      );
    const results = await Promise.allSettled([
      processInboundMessage(id, reordered, 'synthetic-ttl-a', 'ttl-key'),
      processInboundMessage(id, reordered, 'synthetic-ttl-b', 'ttl-key'),
    ]);
    assert.ok(results.some((r) => r.status === 'fulfilled'));
    assert.equal(
      (
        await pool
          .request()
          .input('id', id)
          .query('SELECT count(*) total FROM "Messages" WHERE channel_id=@id')
      ).recordset[0].total,
      3,
    );
    assert.equal(
      (
        await pool
          .request()
          .input('id', initial.inboundMessageId)
          .query('SELECT dedupe_key FROM "Messages" WHERE id=@id')
      ).recordset[0].dedupe_key,
      null,
    );
    const current = (
      await pool
        .request()
        .input('id', id)
        .query(
          'SELECT id FROM "Messages" WHERE channel_id=@id AND dedupe_expires_at IS NOT NULL AND dedupe_key IS NOT NULL',
        )
    ).recordset[0].id;
    await pool
      .request()
      .input('id', current)
      .query(
        `UPDATE "Messages" SET status='IN-PROCESS',dedupe_expires_at=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE id=@id`,
      );
    await idempotencyCleanupTick();
    assert.ok(
      (
        await pool
          .request()
          .input('id', current)
          .query('SELECT dedupe_key FROM "Messages" WHERE id=@id')
      ).recordset[0].dedupe_key,
    );
    await pool
      .request()
      .input('id', current)
      .query(`UPDATE "Messages" SET status='RECEIVED' WHERE id=@id`);
    await idempotencyCleanupTick();
    const evidence = (
      await pool
        .request()
        .input('id', current)
        .query(
          'SELECT dedupe_key,idempotency_key_hash,original_payload FROM "Messages" WHERE id=@id',
        )
    ).recordset[0];
    assert.equal(evidence.dedupe_key, null);
    assert.ok(evidence.idempotency_key_hash);
    assert.ok(evidence.original_payload);
  } finally {
    config.inbound.idempotencyRetentionHours = previous;
  }
});
test('real PostgreSQL: destination policy bounds concurrency, half-open probe and audited reset reject stale owners', async () => {
  const auth = await syntheticAdminAuth();
  const policy = { failureThreshold: 1, openSeconds: 1, maxConcurrency: 1 };
  const created = await request(app)
    .post('/api/channel')
    .set('Authorization', auth)
    .send({
      name: 'Synthetic circuit policy',
      source: { type: 'HTTP', inboundDataType: 'JSON' },
      destinations: [
        {
          name: 'Synthetic circuit sender',
          type: 'REST',
          endpoint: `http://127.0.0.1:${port}`,
          deliveryPolicy: policy,
        },
      ],
    });
  assert.equal(created.status, 201);
  const id = created.body.channelId,
    destination = (
      await pool
        .request()
        .input('id', id)
        .query('SELECT id FROM "Destinations" WHERE channel_id=@id')
    ).recordset[0].id;
  const messages = [];
  for (let index = 0; index < 2; index++)
    messages.push(
      (
        await pool
          .request()
          .input('id', id)
          .input('dest', destination)
          .query(
            `INSERT INTO "Messages"(channel_id,destination_id,direction,message_type,original_payload,transformed_payload,status) VALUES(@id,@dest,'OUT','JSON','{}','{}','OUT-ERROR') RETURNING id`,
          )
      ).recordset[0].id,
    );
  const slot = await acquireDelivery(messages[0], destination, policy);
  assert.equal(slot.acquired, true);
  assert.equal(
    (await acquireDelivery(messages[1], destination, policy)).reason,
    'DELIVERY_CAPACITY',
  );
  assert.equal(
    (
      await request(app)
        .post(`/api/destination/${destination}/circuit/reset`)
        .set('Authorization', auth)
        .send({ reason: 'SYNTHETIC_TEST' })
    ).status,
    409,
  );
  await releaseDelivery(messages[0], destination, slot.owner, false, policy);
  assert.equal(
    (await acquireDelivery(messages[1], destination, policy)).reason,
    'DESTINATION_CIRCUIT_OPEN',
  );
  await pool
    .request()
    .input('id', destination)
    .query(
      `UPDATE "DestinationRuntime" SET open_until=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE destination_id=@id`,
    );
  const probe = await acquireDelivery(messages[1], destination, policy);
  assert.equal(probe.acquired, true);
  assert.equal(
    (await acquireDelivery(messages[0], destination, policy)).reason,
    'DESTINATION_CIRCUIT_OPEN',
  );
  await releaseDelivery(messages[1], destination, probe.owner, true, policy);
  assert.equal(
    (
      await request(app)
        .post(`/api/destination/${destination}/circuit/reset`)
        .set('Authorization', auth)
        .send({ reason: 'SYNTHETIC_TEST' })
    ).status,
    200,
  );
  await releaseDelivery(messages[0], destination, 'synthetic-stale-owner', false, policy);
  assert.equal(
    (
      await pool
        .request()
        .input('id', destination)
        .query('SELECT failure_count FROM "DestinationRuntime" WHERE destination_id=@id')
    ).recordset[0].failure_count,
    0,
  );
  assert.equal(
    (
      await pool
        .request()
        .input('id', destination)
        .query(
          `SELECT count(*) total FROM "AuditLog" WHERE resource_id=@id AND action='RESET_CIRCUIT_SYNTHETIC_TEST'`,
        )
    ).recordset[0].total,
    1,
  );
});
test('real PostgreSQL: protected diagnostic bundle has metadata only and reports schema/pool state', async () => {
  const auth = await syntheticAdminAuth();
  const diagnostic = await request(app).get('/api/system/diagnostics').set('Authorization', auth);
  assert.equal(diagnostic.status, 200);
  assert.deepEqual(diagnostic.body.schemaVersions, [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(diagnostic.body.databasePool.database_pool_total > 0);
  const body = JSON.stringify(diagnostic.body);
  for (const value of [
    'synthetic-secret',
    'synthetic-token',
    'original_payload',
    'password_hash',
    config.auth.jwtSecret,
    config.encryptionKey,
  ])
    assert.ok(!body.includes(value));
  const settings = await request(app).get('/api/system/configuration').set('Authorization', auth);
  assert.equal(settings.status, 200);
  assert.equal(settings.body.data.transport.postgresTlsVerified, false);
  for (const role of ['VIEWER', 'OPERATOR', 'DEVELOPER']) {
    const user = (
      await pool
        .request()
        .input('username', 'diagnostic-' + role + suffix)
        .input('role', role)
        .query(
          `INSERT INTO "Users"(username,name,password_hash,role) VALUES(@username,'Synthetic restricted user','synthetic-unused-hash',@role) RETURNING id,name,role`,
        )
    ).recordset[0];
    const restricted = 'Bearer ' + signToken({ id: user.id, name: user.name, role: user.role });
    assert.equal(
      (await request(app).get('/api/system/diagnostics').set('Authorization', restricted)).status,
      403,
    );
    assert.equal(
      (await request(app).get('/api/system/configuration').set('Authorization', restricted)).status,
      403,
    );
  }
});

test('real PostgreSQL: JSON to XML matches the received body and audited outbound preview after API key rotation', async () => {
  const auth = await syntheticAdminAuth();
  const configuration = {
    name: 'Synthetic JSON XML usability ' + suffix,
    source: { type: 'HTTP', inboundDataType: 'JSON' },
    destinations: [
      {
        name: 'Synthetic XML receiver',
        type: 'REST',
        endpoint: `http://127.0.0.1:${port}`,
        outboundDataType: 'XML',
      },
    ],
  };
  const created = await request(app)
    .post('/api/channel')
    .set('Authorization', auth)
    .send(configuration);
  assert.equal(created.status, 201);
  const id = created.body.channelId;
  assert.equal(
    created.body.sourceEndpoint,
    `${config.inbound.baseUrl}${config.inbound.path}/${id}`,
  );
  const credential = () =>
    request(app).put(`/api/channel/${id}/credential`).set('Authorization', auth);
  const originalKey = (await credential()).body.data.apiKey;
  const rotated = await credential();
  assert.equal(rotated.status, 200);
  const currentKey = rotated.body.data.apiKey;
  assert.notEqual(currentKey, originalKey);
  assert.equal(
    (
      await request(app)
        .put(`/api/channel/${id}/status`)
        .set('Authorization', auth)
        .send({ status: 'RUNNING' })
    ).status,
    200,
  );
  const message = { Patient: { name: 'SYNTHETIC NAME', reference: 'SYNTHETIC-ONLY' } };
  const inbound = () => request(app).post(`/api/message/inbound/${id}`).send(message);
  assert.equal((await inbound().set('X-API-Key', originalKey)).status, 401);
  const before = received;
  const preview = await request(app)
    .post('/api/channel/dry-run')
    .set('Authorization', auth)
    .send({ configuration, payload: message, raw: true });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.networkDelivery, 'NOT_SENT');
  assert.equal(received, before);
  const sent = await inbound()
    .set('X-API-Key', currentKey)
    .set('Idempotency-Key', 'synthetic-usability-' + suffix);
  assert.equal(sent.status, 200);
  assert.equal(sent.body.result.inboundStatus, 'SUCCESS');
  assert.equal(received, before + 1);
  assert.match(receivedBodies.at(-1)!, /<Patient>/);
  assert.match(receivedBodies.at(-1)!, /SYNTHETIC NAME/);
  assert.equal(preview.body.results[0].finalPayload, receivedBodies.at(-1));
  const messageId = sent.body.result.inboundMessageId;
  const detail = await request(app).get(`/api/message/${messageId}`).set('Authorization', auth);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.inboundFormat, 'JSON');
  assert.equal(detail.body.data.sourceTransformed, false);
  assert.equal(detail.body.data.originalPayload.Patient, '[REDACTED]');
  assert.equal(detail.body.data.destinationLogs[0].outboundFormat, 'XML');
  assert.equal(detail.body.data.destinationLogs[0].outboundData, '[REDACTED TEXT]');
  const raw = await request(app)
    .get(`/api/message/${messageId}?raw=true`)
    .set('Authorization', auth);
  assert.equal(raw.status, 200);
  assert.deepEqual(raw.body.data.originalPayload, message);
  assert.deepEqual(raw.body.data.transformedPayload, message);
  assert.equal(raw.body.data.destinationLogs[0].outboundData, receivedBodies.at(-1));
  assert.equal(raw.body.data.destinationLogs[0].status, 'OUT-SENT');
  assert.equal(raw.body.data.destinationLogs[0].snapshotCaptured, true);
  const audits = (
    await pool
      .request()
      .input('id', messageId)
      .query('SELECT action FROM "AuditLog" WHERE resource_id=@id')
  ).recordset;
  assert.ok(audits.some((entry) => entry.action === 'VIEW_MESSAGE_RAW'));
});

test('real PostgreSQL: visual field mappings preserve routing and final outbound XML with actual HTTP status', async () => {
  const auth = await syntheticAdminAuth();
  const processingScript = compileFieldMapping({
    version: 1,
    rootElement: 'Patient',
    rows: [
      { source: 'patient_id', target: 'PatientID', required: true },
      { source: 'name', target: 'PatientName', required: true },
      { source: 'gender', target: 'Gender', required: false, defaultValue: 'U' },
      { source: 'date_of_birth', target: 'BirthDate', required: false, defaultValue: '2000-01-01' },
    ],
  });
  const configuration = {
    name: 'Visual mapping integration ' + suffix,
    source: { type: 'HTTP', inboundDataType: 'JSON' },
    processingScript,
    validationProfile: { basicSyntax: true },
    filterScript: 'return true;',
    destinations: [
      {
        name: 'PATIENT_XML_RECEIVER',
        type: 'REST',
        endpoint: `http://127.0.0.1:${port}`,
        outboundDataType: 'XML',
      },
      {
        name: 'Filtered route',
        type: 'REST',
        endpoint: `http://127.0.0.1:${port}`,
        outboundDataType: 'JSON',
        filterScript: 'return false;',
      },
    ],
  };
  const created = await request(app)
    .post('/api/channel')
    .set('Authorization', auth)
    .send(configuration);
  assert.equal(created.status, 201);
  const id = created.body.channelId;
  const credential = await request(app)
    .put(`/api/channel/${id}/credential`)
    .set('Authorization', auth);
  assert.equal(credential.status, 200);
  assert.equal(
    (
      await request(app)
        .put(`/api/channel/${id}/status`)
        .set('Authorization', auth)
        .send({ status: 'RUNNING' })
    ).status,
    200,
  );
  // The patient-shaped values below are the explicitly requested synthetic acceptance fixture.
  const input = {
    patient_id: 'RM-000123',
    name: 'Siti Aminah',
    gender: 'F',
    date_of_birth: '1993-08-17',
  };
  const expectedXml = [
    '<Patient>',
    '  <PatientID>RM-000123</PatientID>',
    '  <PatientName>Siti Aminah</PatientName>',
    '  <Gender>F</Gender>',
    '  <BirthDate>1993-08-17</BirthDate>',
    '</Patient>',
  ].join('\n');
  const before = received;
  const preview = await request(app)
    .post('/api/channel/preview-transformation')
    .set('Authorization', auth)
    .send({ configuration, payload: input, raw: true });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.networkDelivery, 'NOT_SENT');
  assert.equal(received, before);
  const delivered = await request(app)
    .post(`/api/message/inbound/${id}`)
    .set('X-API-Key', credential.body.data.apiKey)
    .send(input);
  assert.equal(delivered.status, 200);
  assert.equal(delivered.body.status, 'SUCCESS');
  assert.equal(delivered.body.messageId, delivered.body.result.inboundMessageId);
  assert.equal(received, before + 1);
  assert.equal(receivedBodies.at(-1), preview.body.results[0].finalPayload);
  assert.equal(receivedBodies.at(-1), expectedXml);
  assert.equal(preview.body.results[1].routed, false);
  const detail = await request(app)
    .get(`/api/message/${delivered.body.result.inboundMessageId}?raw=true`)
    .set('Authorization', auth);
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body.data.originalPayload, input);
  assert.deepEqual(detail.body.data.transformedPayload, {
    Patient: {
      PatientID: input.patient_id,
      PatientName: input.name,
      Gender: input.gender,
      BirthDate: input.date_of_birth,
    },
  });
  const xmlAttempt = detail.body.data.destinationLogs.find(
    (entry: { outboundFormat?: string; status: string }) =>
      entry.outboundFormat === 'XML' && entry.status === 'OUT-SENT',
  );
  assert.ok(xmlAttempt);
  assert.equal(xmlAttempt.httpStatus, 200);
  assert.equal(xmlAttempt.destinationName, 'PATIENT_XML_RECEIVER');
  assert.equal(xmlAttempt.attemptCount, 1);
  assert.ok(Number.isFinite(xmlAttempt.durationMs) && xmlAttempt.durationMs >= 0);
  assert.equal(xmlAttempt.outboundData, receivedBodies.at(-1));
  const channel = (await request(app).get('/api/channel').set('Authorization', auth)).body.find(
    (entry: { id: number }) => entry.id === id,
  );
  assert.equal(readFieldMapping(channel.processingScript)?.rows.length, 4);
  const failed = await request(app)
    .post(`/api/message/inbound/${id}`)
    .set('X-API-Key', credential.body.data.apiKey)
    .send({ name: 'SYNTHETIC MISSING REQUIRED' });
  // Required mapping rejects source processing before delivery; the script boundary
  // returns its existing safe 422 contract rather than a destination HTTP failure.
  assert.equal(failed.status, 422);
  assert.equal(failed.body.code, 'SCRIPT_EXECUTION_FAILED');
  assert.equal(received, before + 1);
  assert.ok(!JSON.stringify(failed.body).includes('SYNTHETIC MISSING REQUIRED'));

  const filteredConfiguration = {
    ...configuration,
    name: 'Simple filter integration ' + suffix,
    filterScript: compileSimpleCondition({
      version: 1,
      field: 'message_type',
      operator: 'eq',
      value: 'ADT',
    }),
  };
  const filteredChannel = await request(app)
    .post('/api/channel')
    .set('Authorization', auth)
    .send(filteredConfiguration);
  assert.equal(filteredChannel.status, 201);
  const filteredId = filteredChannel.body.channelId;
  const filteredKey = await request(app)
    .put(`/api/channel/${filteredId}/credential`)
    .set('Authorization', auth);
  assert.equal(filteredKey.status, 200);
  assert.equal(
    (
      await request(app)
        .put(`/api/channel/${filteredId}/status`)
        .set('Authorization', auth)
        .send({ status: 'RUNNING' })
    ).status,
    200,
  );
  const filtered = await request(app)
    .post(`/api/message/inbound/${filteredId}`)
    .set('X-API-Key', filteredKey.body.data.apiKey)
    .send({ ...input, message_type: 'ORM' });
  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.status, 'FILTERED');
  assert.deepEqual(filtered.body.result.outboundResults, []);
  assert.equal(received, before + 1);
  const filterDetail = await request(app)
    .get(`/api/message/${filtered.body.messageId}?raw=true`)
    .set('Authorization', auth);
  assert.equal(filterDetail.status, 200);
  assert.equal(filterDetail.body.data.status, 'FILTERED');
  assert.deepEqual(filterDetail.body.data.destinationLogs, []);
});

test('real PostgreSQL: key rotation failure rolls back all records and new keyring reads rotated snapshots', async () => {
  const id = (
    await pool
      .request()
      .input('key', 'enc:v2:missing:invalid')
      .query(
        `INSERT INTO "Channels"(name,status,source_type,inbound_data_type,source_api_key) VALUES('Synthetic rotation failure','STOPPED','HTTP','JSON',@key) RETURNING id`,
      )
  ).recordset[0].id;
  const destination = (
    await pool
      .request()
      .input('id', id)
      .input('endpoint', encrypt('http://localhost/synthetic'))
      .query(
        `INSERT INTO "Destinations"(channel_id,name,type,endpoint,outbound_data_type) VALUES(@id,'Synthetic rotation destination','REST',@endpoint,'JSON') RETURNING id,endpoint`,
      )
  ).recordset[0];
  await assert.rejects(rotateSecrets(false), /Encrypted configuration cannot be read/);
  assert.equal(
    (
      await pool
        .request()
        .input('id', destination.id)
        .query('SELECT endpoint FROM "Destinations" WHERE id=@id')
    ).recordset[0].endpoint,
    destination.endpoint,
  );
  await pool
    .request()
    .input('id', id)
    .query('UPDATE "Channels" SET source_api_key=NULL WHERE id=@id');
  const previous = {
    key: config.encryptionKey,
    id: config.encryptionKeyId,
    ring: config.previousEncryptionKeys,
  };
  config.encryptionKey = 'b'.repeat(64);
  config.encryptionKeyId = 'next';
  config.previousEncryptionKeys = JSON.stringify({ [previous.id]: previous.key });
  try {
    assert.ok((await rotateSecrets(true)).recordsVerified > 0);
    const result = await rotateSecrets(false);
    assert.ok(result.recordsUpdated > 0);
    const value = (
      await pool
        .request()
        .input('id', destination.id)
        .query('SELECT endpoint FROM "Destinations" WHERE id=@id')
    ).recordset[0].endpoint;
    assert.ok(value.startsWith('enc:v2:next:'));
    assert.equal(decrypt(value), 'http://localhost/synthetic');
  } finally {
    config.encryptionKey = previous.key;
    config.encryptionKeyId = previous.id;
    config.previousEncryptionKeys = previous.ring;
  }
});
