// Opt-in real PostgreSQL validation. Uses an isolated, newly created mirth_test_* schema.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import pg from 'pg';
import { retryTick, retentionTick } from '../src/services/worker.services.js';
import { processInboundMessage } from '../src/services/messageProcessor.services.js';
import { sample } from './fixtures.js';
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
const suffix = randomUUID();
const username = 'qa-' + suffix;
const receiver = http.createServer((_req, res) => {
  received++;
  res.setHeader('Content-Type', 'application/json');
  res.end('{"ok":true}');
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
  port = (receiver.address() as import('node:net').AddressInfo).port;
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
  });
  assert.equal(
    (await pool.request().query('SELECT count(*) total FROM "SchemaMigrations"')).recordset[0]
      .total,
    1,
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
