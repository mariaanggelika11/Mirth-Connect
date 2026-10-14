import pg from 'pg';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
const bcrypt = createRequire(new URL('../server/package.json', import.meta.url))('bcrypt');
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL_REQUIRED');
const parsed = new URL(url);
if (
  !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
  !/^mirth_disposable_[a-z0-9_]+$/.test(parsed.pathname.slice(1))
)
  throw new Error('RUNTIME_TEST_REQUIRES_LOCAL_DISPOSABLE_DATABASE');
const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: url,
  PG_SCHEMA: 'public',
  PG_SSL: 'false',
  JWT_SECRET: 'synthetic-runtime-only-signing-secret-32-characters',
  CONFIG_ENCRYPTION_KEY: 'a'.repeat(64),
  CONFIG_ENCRYPTION_KEY_ID: 'current',
  CONFIG_ENCRYPTION_PREVIOUS_KEYS: '{}',
  INBOUND_API_KEY: 'synthetic-runtime-only-source-secret-32',
  OUTBOUND_ALLOWED_HOSTS: '127.0.0.1,localhost',
  HL7_ENABLED: 'false',
  LOG_LEVEL: 'silent',
  ALERT_WEBHOOK_URL: '',
  RETENTION_ENABLED: 'false',
  PORT: '19091',
  HOST: '127.0.0.1',
  INBOUND_PATH: '/api/inbound',
  INBOUND_BASE_URL: 'http://127.0.0.1:19091',
};
async function run(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: 'ignore' });
    child.once('error', () => reject(new Error('SMOKE_TOOL_FAILED')));
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('SMOKE_COMMAND_FAILED')),
    );
  });
}
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const count = Number(
    (
      await client.query(
        "SELECT count(*) total FROM information_schema.tables WHERE table_schema='public'",
      )
    ).rows[0].total,
  );
  assert.equal(count, 0, 'Runtime smoke requires an empty disposable database');
  await run(['server/dist/scripts/migrate.js', '--dry-run']);
  await run(['server/dist/scripts/migrate.js']);
  await client.query(
    "INSERT INTO \"Channels\"(name,status,source_type,inbound_data_type) VALUES('Synthetic legacy migration fixture','STOPPED','HTTP','JSON')",
  );
  await run(['server/dist/scripts/migrate.js']);
  assert.deepEqual(
    (await client.query('SELECT version FROM "SchemaMigrations" ORDER BY version')).rows.map(
      (r) => r.version,
    ),
    [1, 2, 3, 4, 5],
  );
  assert.equal(
    Number((await client.query('SELECT count(*) total FROM "ChannelRevisions"')).rows[0].total),
    1,
  );
  assert.equal(
    (await client.query('SELECT active_revision FROM "Channels"')).rows[0].active_revision,
    1,
  );
  const syntheticPassword = randomUUID() + randomUUID();
  await client.query('INSERT INTO "Users"(username,name,password_hash,role) VALUES($1,$2,$3,$4)', [
    'runtime-synthetic',
    'Synthetic runtime admin',
    await bcrypt.hash(syntheticPassword, 12),
    'ADMIN',
  ]);
  const child = spawn(process.execPath, ['server/dist/server.js'], { env, stdio: 'ignore' });
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  let receiver;
  let inFlight;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const response = await fetch('http://127.0.0.1:19091/ready', {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        /* Await bounded startup. */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'Disposable runtime did not become ready');
    assert.equal((await fetch('http://127.0.0.1:19091/health')).status, 200);
    assert.equal((await fetch('http://127.0.0.1:19091/metrics')).status, 401);
    const auth = await fetch('http://127.0.0.1:19091/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'runtime-synthetic', password: syntheticPassword }),
    }).then((r) => r.json());
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth.token };
    let received;
    const deliveryStarted = new Promise((resolve) => {
      received = resolve;
    });
    receiver = http.createServer((_req, res) => {
      received();
      setTimeout(() => res.end('synthetic response'), 300);
    });
    await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
    const created = await fetch('http://127.0.0.1:19091/api/channel', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Synthetic active shutdown',
        source: { type: 'HTTP', inboundDataType: 'JSON' },
        destinations: [
          {
            name: 'Synthetic receiver',
            type: 'REST',
            endpoint: 'http://127.0.0.1:' + receiver.address().port,
            outboundDataType: 'JSON',
          },
        ],
      }),
    }).then((r) => r.json());
    assert.ok(created.channelId);
    const key = await fetch(
      'http://127.0.0.1:19091/api/channel/' + created.channelId + '/credential',
      { method: 'PUT', headers },
    ).then((r) => r.json());
    assert.equal(
      (
        await fetch('http://127.0.0.1:19091/api/channel/' + created.channelId + '/status', {
          method: 'PUT',
          headers,
          body: JSON.stringify({ status: 'RUNNING' }),
        })
      ).status,
      200,
    );
    inFlight = fetch('http://127.0.0.1:19091/api/inbound/' + created.channelId, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': key.data.apiKey,
        'Idempotency-Key': 'synthetic-shutdown',
      },
      body: JSON.stringify({ fixture: 'synthetic' }),
      signal: AbortSignal.timeout(10000),
    });
    await Promise.race([
      deliveryStarted,
      inFlight.then(async (response) => {
        if (!response.ok) {
          const body = await response.json();
          throw new Error(
            'SYNTHETIC_INBOUND_FAILED_' + response.status + '_' + (body.code || 'UNKNOWN'),
          );
        }
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('SYNTHETIC_DELIVERY_START_TIMEOUT')), 5000),
      ),
    ]);
  } finally {
    child.kill('SIGTERM');
  }
  if (inFlight) {
    const result = await inFlight;
    assert.equal(result.status, 200);
    assert.equal((await result.json()).result.inboundStatus, 'SUCCESS');
  }
  assert.equal(await exited, 0, 'SIGTERM shutdown must exit cleanly');
  if (receiver) await new Promise((resolve) => receiver.close(() => resolve()));
  assert.equal(
    Number(
      (
        await client.query(
          `SELECT count(*) total FROM "Messages" WHERE direction='OUT' AND status='OUT-SENT'`,
        )
      ).rows[0].total,
    ),
    1,
  );
  console.info(
    'PASS: migration preflight + repeated migrations + existing-channel baseline + actual startup + health/readiness + protected metrics + SIGTERM during active synthetic delivery',
  );
} finally {
  await client.end();
}
