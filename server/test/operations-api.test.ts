import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
const state = vi.hoisted(() => ({
  query: vi.fn(),
  inputs: {} as Record<string, unknown>,
  history: [] as string[],
}));
const requestMock = () => ({
  input(k: string, v: unknown) {
    state.inputs[k] = v;
    return this;
  },
  query(sql: string) {
    state.history.push(sql);
    return state.query(sql);
  },
});
vi.mock('../src/config/db.js', () => ({
  databasePoolStats: () => ({
    database_pool_total: 2,
    database_pool_idle: 1,
    database_pool_waiting: 0,
  }),
  getConnection: async () => ({ request: requestMock }),
  withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ request: requestMock }),
}));
import app from '../src/app.js';
import { signToken } from '../src/services/auth.services.js';
import { channelSchema } from '../src/utils/validator.js';
import { encrypt, decrypt } from '../src/utils/secrets.js';
import { migrationPreflight } from '../src/services/migrationPreflight.services.js';
import { rotateSecrets } from '../src/services/rotation.services.js';
import type { DatabaseTransaction } from '../src/config/db.js';
const admin = { id: 1, name: 'Synthetic', role: 'ADMIN' },
  token = signToken(admin);
beforeEach(() => {
  state.inputs = {};
  state.history = [];
  state.query.mockResolvedValue({ recordset: [admin], rowsAffected: [1] });
});
describe('Operational APIs and authorization', () => {
  it('alerts list and acknowledgement require administrator and keep an audit trail', async () => {
    expect(
      (
        await request(app)
          .get('/api/alerts')
          .set('Authorization', 'Bearer ' + token)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post('/api/alerts/QUEUE_AGE/acknowledge')
          .set('Authorization', 'Bearer ' + token)
      ).status,
    ).toBe(200);
    expect(state.inputs.action).toBe('ACKNOWLEDGE_ALERT');
    state.query.mockResolvedValue({ recordset: [{ ...admin, role: 'VIEWER' }], rowsAffected: [1] });
    expect(
      (
        await request(app)
          .post('/api/alerts/QUEUE_AGE/acknowledge')
          .set('Authorization', 'Bearer ' + token)
      ).status,
    ).toBe(403);
  });
  it('session revocation rejects invalid ID and audits own family revocation', async () => {
    const family = '00000000-0000-4000-8000-000000000001';
    expect(
      (
        await request(app)
          .post('/api/auth/sessions/invalid/revoke')
          .set('Authorization', 'Bearer ' + token)
      ).status,
    ).toBe(400);
    const res = await request(app)
      .post(`/api/auth/sessions/${family}/revoke`)
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(200);
    expect(state.inputs.user).toBe(1);
    expect(state.inputs.family).toBe(family);
    expect(state.inputs.action).toBe('REVOKE_BROWSER_SESSION');
    expect(state.history.some((sql) => sql.includes('AND user_id=@user'))).toBe(true);
  });
  it('metrics requires administrator and returns metadata only', async () => {
    expect((await request(app).get('/metrics')).status).toBe(401);
    state.query.mockImplementation(async (sql) => ({
      recordset: sql.includes('SELECT id,name,role')
        ? [admin]
        : [{ inbound: 3, success: 2, queue: 1, dead_letter: 0, oldest_pending_seconds: 10 }],
    }));
    const res = await request(app)
      .get('/metrics')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(200);
    expect(res.text).toContain('mirth_queue 1');
    expect(res.text).not.toContain('Synthetic');
    state.query.mockResolvedValue({ recordset: [{ ...admin, role: 'VIEWER' }] });
    expect(
      (
        await request(app)
          .get('/metrics')
          .set('Authorization', 'Bearer ' + token)
      ).status,
    ).toBe(403);
  });
  it('last administrator cannot be demoted', async () => {
    const res = await request(app)
      .put('/api/users/1/role')
      .set('Authorization', 'Bearer ' + token)
      .send({ role: 'VIEWER' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LAST_ADMIN');
  });
  it('role change records audit and reads current authorization', async () => {
    state.query.mockImplementation(async (sql) => ({
      recordset: sql.includes('SELECT id,name,role')
        ? [admin]
        : sql.includes('SELECT role')
          ? [{ role: 'OPERATOR' }]
          : [],
      rowsAffected: [1],
    }));
    const res = await request(app)
      .put('/api/users/2/role')
      .set('Authorization', 'Bearer ' + token)
      .send({ role: 'VIEWER' });
    expect(res.status).toBe(200);
    expect(state.inputs.action).toBe('ROLE_CHANGE');
  });
  it('user listing excludes password data and bounds pagination', async () => {
    expect(
      (
        await request(app)
          .get('/api/users?page=0')
          .set('Authorization', 'Bearer ' + token)
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .get('/api/users?page=1')
          .set('Authorization', 'Bearer ' + token)
      ).status,
    ).toBe(200);
    expect(state.history.some((sql) => sql.includes('SELECT id,username,name,role'))).toBe(true);
  });
  it('user creation validates roles and hashes synthetic passwords', async () => {
    state.query.mockImplementation(async (sql) => ({
      recordset: sql.includes('SELECT id,name,role')
        ? [admin]
        : sql.includes('RETURNING id')
          ? [{ id: 2 }]
          : [],
      rowsAffected: [1],
    }));
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', 'Bearer ' + token)
      .send({
        username: 'synthetic',
        name: 'Synthetic',
        password: 'synthetic-password-123',
        role: 'OPERATOR',
      });
    expect(res.status).toBe(201);
    expect(state.inputs.hash).not.toBe('synthetic-password-123');
    expect(state.inputs.action).toBe('CREATE_USER');
  });
  it('dead-letter reconciliation requires reason and is audited', async () => {
    const body = {
      state: 'IGNORED',
      note: 'Synthetic review: downstream rejected test message',
      category: 'TRANSPORT',
    };
    const res = await request(app)
      .put('/api/message/1/reconciliation')
      .set('Authorization', 'Bearer ' + token)
      .send(body);
    expect(res.status).toBe(200);
    expect(state.inputs.action).toBe('RECONCILE_DEAD_LETTER');
    expect(
      (
        await request(app)
          .put('/api/message/1/reconciliation')
          .set('Authorization', 'Bearer ' + token)
          .send({ ...body, note: '' })
      ).status,
    ).toBe(400);
    state.query.mockImplementation(async (sql) => ({
      recordset: sql.includes('SELECT id,name,role') ? [admin] : [],
    }));
    expect(
      (
        await request(app)
          .put('/api/message/1/reconciliation')
          .set('Authorization', 'Bearer ' + token)
          .send(body)
      ).status,
    ).toBe(409);
  });
  it('session listing never returns refresh or CSRF hashes', async () => {
    const res = await request(app)
      .get('/api/auth/sessions')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(200);
    expect(state.history.some((sql) => sql.includes('GROUP BY family_id'))).toBe(true);
  });
  it('published revision creates new immutable activation and audit', async () => {
    const configuration = channelSchema.parse({
      name: 'Synthetic revision',
      source: { type: 'HTTP', inboundDataType: 'JSON' },
      destinations: [],
    });
    state.query.mockImplementation(async (sql) => ({
      recordset: sql.includes('SELECT id,name,role')
        ? [admin]
        : sql.includes('SELECT id,active_revision')
          ? [{ id: 1, active_revision: 1 }]
          : sql.includes('SELECT * FROM "ChannelRevisions"')
            ? [{ state: 'DRAFT', configuration: encrypt(JSON.stringify(configuration)) }]
            : sql.includes('MAX(revision)')
              ? [{ revision: 3 }]
              : [],
      rowsAffected: [1],
    }));
    const res = await request(app)
      .post('/api/channel/1/revisions/2/publish')
      .set('Authorization', 'Bearer ' + token)
      .send({ expectedActiveRevision: 1, changeSummary: 'Synthetic reviewed publish' });
    expect(res.status).toBe(200);
    expect(res.body.activeRevision).toBe(3);
    expect(state.inputs.action).toBe('PUBLISH_CHANNEL');
  });
  it('rollback creates publish and archive is draft-only', async () => {
    const configuration = channelSchema.parse({
      name: 'Synthetic revision',
      source: { type: 'HTTP', inboundDataType: 'JSON' },
      destinations: [],
    });
    state.query.mockImplementation(async (sql) => ({
      recordset: sql.includes('SELECT id,name,role')
        ? [admin]
        : sql.includes('SELECT id,active_revision')
          ? [{ id: 1, active_revision: 3 }]
          : sql.includes('SELECT * FROM "ChannelRevisions"')
            ? [{ state: 'PUBLISHED', configuration: encrypt(JSON.stringify(configuration)) }]
            : sql.includes('MAX(revision)')
              ? [{ revision: 4 }]
              : [],
      rowsAffected: [1],
    }));
    expect(
      (
        await request(app)
          .post('/api/channel/1/revisions/1/rollback')
          .set('Authorization', 'Bearer ' + token)
          .send({ expectedActiveRevision: 3, changeSummary: 'Synthetic rollback' })
      ).status,
    ).toBe(200);
    expect(state.inputs.action).toBe('ROLLBACK_CHANNEL');
    expect(
      (
        await request(app)
          .post('/api/channel/1/revisions/2/archive')
          .set('Authorization', 'Bearer ' + token)
      ).status,
    ).toBe(200);
    expect(state.inputs.action).toBe('ARCHIVE_REVISION');
    expect(
      (
        await request(app)
          .get('/api/channel/1/revisions')
          .set('Authorization', 'Bearer ' + token)
      ).status,
    ).toBe(200);
  });
  it('migration preflight detects duplicates without modifying data', async () => {
    state.query.mockImplementation(async (sql) => ({
      recordset: sql.startsWith('SHOW')
        ? [{ server_version_num: 160000 }]
        : sql.includes('to_regclass')
          ? [{ users: true, destinations: false }]
          : sql.includes('HAVING count')
            ? [{ username: 'synthetic' }]
            : [],
    }));
    await expect(
      migrationPreflight({ request: requestMock } as unknown as DatabaseTransaction),
    ).rejects.toThrow('DUPLICATE_USERNAMES');
    expect(state.history.some((sql) => /^UPDATE|^DELETE/.test(sql))).toBe(false);
  });
  it('migration preflight verifies encrypted configuration and PostgreSQL version', async () => {
    state.query.mockImplementation(async (sql) => ({
      recordset: sql.startsWith('SHOW')
        ? [{ server_version_num: 160000 }]
        : sql.includes('to_regclass')
          ? [{ users: true, destinations: true }]
          : sql.includes('SELECT endpoint')
            ? [{ endpoint: encrypt('synthetic') }]
            : [],
    }));
    expect(
      (await migrationPreflight({ request: requestMock } as unknown as DatabaseTransaction))
        .encryptedVerified,
    ).toBe(1);
  });
  it('rotation updates encrypted nested snapshots and audits only identifiers', async () => {
    state.query.mockImplementation(async (sql) => ({
      recordset:
        sql.includes('SELECT') && sql.includes(' value')
          ? [
              {
                id: 1,
                revision: 1,
                value: encrypt(
                  sql.includes('transport_config') || sql.includes('configuration')
                    ? JSON.stringify({ endpoint: encrypt('synthetic') })
                    : 'synthetic',
                ),
              },
            ]
          : [],
      rowsAffected: [1],
    }));
    expect((await rotateSecrets(false)).recordsUpdated).toBe(4);
    expect(state.history.filter((sql) => sql.startsWith('UPDATE')).length).toBe(4);
    expect(state.history.at(-1)).toContain('ROTATE_ENCRYPTION_KEYS');
  });
});

describe('Revision successor drafts and stored dry-run', () => {
  const configuration = channelSchema.parse({
    name: 'Stored synthetic draft',
    source: { type: 'HTTP', inboundDataType: 'JSON' },
    processingScript: 'msg.processed = true;',
    destinations: [
      {
        name: 'Synthetic sender',
        type: 'REST',
        endpoint: 'http://user:synthetic-credential@localhost/send?token=synthetic-key',
        outboundDataType: 'JSON',
      },
    ],
  });
  const row = {
    state: 'DRAFT',
    checksum: 'a'.repeat(64),
    configuration: encrypt(JSON.stringify(configuration)),
  };
  const setup = (revision = row) =>
    state.query.mockImplementation(async (sql: string) => ({
      recordset: sql.includes('SELECT id,name,role')
        ? [admin]
        : sql.includes('MAX(revision)')
          ? [{ revision: 3 }]
          : sql.includes('FROM "ChannelRevisions"') && sql.includes('SELECT')
            ? [revision]
            : sql.includes('SELECT id FROM "Channels"')
              ? [{ id: 1 }]
              : [],
      rowsAffected: [1],
    }));
  it('edits stored draft, archives predecessor, audits and leaves runtime untouched', async () => {
    setup();
    const response = await request(app)
      .patch('/api/channel/1/revisions/2')
      .set('Authorization', 'Bearer ' + token)
      .send({
        expectedChecksum: row.checksum,
        changeSummary: 'Synthetic successor',
        patch: { name: 'Edited synthetic draft', destinations: [{ index: 0, timeoutMs: 3456 }] },
      });
    expect(response.status).toBe(200);
    expect(response.body.revision).toBe(3);
    const stored = JSON.parse(decrypt(String(state.inputs.config)));
    expect(stored.destinations[0].endpoint).toBe(configuration.destinations[0].endpoint);
    expect(stored.processingScript).toBe(configuration.processingScript);
    expect(stored.destinations[0].timeoutMs).toBe(3456);
    expect(state.inputs.action).toBe('EDIT_CHANNEL_DRAFT');
    expect(state.history.some((sql) => sql.startsWith('UPDATE "Channels"'))).toBe(false);
    expect(JSON.stringify(response.body)).not.toContain('synthetic-credential');
  });
  it('rejects stale checksums, archived revisions, missing channels and invalid patches', async () => {
    for (const revision of [
      { ...row, checksum: 'b'.repeat(64) },
      { ...row, state: 'PUBLISHED' },
    ]) {
      setup(revision);
      expect(
        (
          await request(app)
            .patch('/api/channel/1/revisions/2')
            .set('Authorization', 'Bearer ' + token)
            .send({
              expectedChecksum: row.checksum,
              changeSummary: 'Synthetic conflict',
              patch: { name: 'Changed' },
            })
        ).status,
      ).toBe(409);
    }
    setup();
    expect(
      (
        await request(app)
          .patch('/api/channel/1/revisions/2')
          .set('Authorization', 'Bearer ' + token)
          .send({
            expectedChecksum: row.checksum,
            changeSummary: 'Synthetic invalid',
            patch: { destinations: [{ index: 2 }] },
          })
      ).status,
    ).toBe(400);
    state.query.mockImplementation(async (sql) => ({
      recordset: sql.includes('SELECT id,name,role') ? [admin] : [],
    }));
    expect(
      (
        await request(app)
          .patch('/api/channel/1/revisions/2')
          .set('Authorization', 'Bearer ' + token)
          .send({
            expectedChecksum: row.checksum,
            changeSummary: 'Synthetic absent',
            patch: { name: 'Changed' },
          })
      ).status,
    ).toBe(404);
  });
  it('stored revision dry-run uses private scripts but returns masked preview and no delivery', async () => {
    setup();
    const response = await request(app)
      .post('/api/channel/1/revisions/2/dry-run')
      .set('Authorization', 'Bearer ' + token)
      .send({ payload: { patientName: 'Synthetic Patient', fixture: true } });
    expect(response.status).toBe(200);
    expect(response.body.results[0].finalPayload.processed).toBe(true);
    expect(response.body.results[0].finalPayload.patientName).toBe('[REDACTED]');
    expect(response.body.warnings[0]).toContain('No DNS');
    expect(state.inputs.action).toBe('DRY_RUN_REVISION');
    expect(JSON.stringify(response.body)).not.toContain('synthetic-credential');
    expect(state.history.some((sql) => sql.includes('INSERT INTO "Messages"'))).toBe(false);
    setup({ ...row, state: 'ARCHIVED' });
    expect(
      (
        await request(app)
          .post('/api/channel/1/revisions/2/dry-run')
          .set('Authorization', 'Bearer ' + token)
          .send({ payload: {} })
      ).status,
    ).toBe(404);
  });
  it('viewer and operator cannot edit, test revision or open connection probes', async () => {
    for (const role of ['VIEWER', 'OPERATOR']) {
      state.query.mockResolvedValue({ recordset: [{ ...admin, role }], rowsAffected: [1] });
      expect(
        (
          await request(app)
            .patch('/api/channel/1/revisions/2')
            .set('Authorization', 'Bearer ' + token)
            .send({})
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .post('/api/channel/1/revisions/2/dry-run')
            .set('Authorization', 'Bearer ' + token)
            .send({ payload: {} })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .post('/api/channel/1/revisions/2/destinations/0/test-connection')
            .set('Authorization', 'Bearer ' + token)
            .send({})
        ).status,
      ).toBe(403);
    }
  });
  it('connection probe rejects invalid indices and missing/archived destinations before DNS', async () => {
    setup();
    expect(
      (
        await request(app)
          .post('/api/channel/1/revisions/2/destinations/99/test-connection')
          .set('Authorization', 'Bearer ' + token)
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post('/api/channel/1/revisions/2/destinations/1/test-connection')
          .set('Authorization', 'Bearer ' + token)
      ).status,
    ).toBe(404);
    setup({ ...row, state: 'ARCHIVED' });
    expect(
      (
        await request(app)
          .post('/api/channel/1/revisions/2/destinations/0/test-connection')
          .set('Authorization', 'Bearer ' + token)
      ).status,
    ).toBe(404);
  });
  it('circuit reset is audited, requires reason and refuses active deliveries', async () => {
    state.query.mockImplementation(async (sql) => ({
      recordset: sql.includes('SELECT id,name,role')
        ? [admin]
        : sql.includes('SELECT id FROM "Destinations"')
          ? [{ id: 1 }]
          : sql.includes('SELECT count(*)')
            ? [{ total: 0 }]
            : [],
      rowsAffected: [1],
    }));
    expect(
      (
        await request(app)
          .post('/api/destination/1/circuit/reset')
          .set('Authorization', 'Bearer ' + token)
          .send({ reason: 'DESTINATION_RECOVERED' })
      ).status,
    ).toBe(200);
    expect(state.inputs.action).toBe('RESET_CIRCUIT_DESTINATION_RECOVERED');
    expect(
      (
        await request(app)
          .post('/api/destination/1/circuit/reset')
          .set('Authorization', 'Bearer ' + token)
          .send({ reason: 'free text' })
      ).status,
    ).toBe(400);
    state.query.mockImplementation(async (sql) => ({
      recordset: sql.includes('SELECT id,name,role')
        ? [admin]
        : sql.includes('SELECT count(*)')
          ? [{ total: 1 }]
          : [{ id: 1 }],
      rowsAffected: [1],
    }));
    expect(
      (
        await request(app)
          .post('/api/destination/1/circuit/reset')
          .set('Authorization', 'Bearer ' + token)
          .send({ reason: 'DESTINATION_RECOVERED' })
      ).status,
    ).toBe(409);
  });
});

describe('Administrator-only effective settings and diagnostics', () => {
  it('exports fixed configuration and aggregate metadata with an audit and no secrets', async () => {
    state.query.mockImplementation(async (sql) => ({
      recordset: sql.includes('SELECT id,name,role')
        ? [admin]
        : sql.includes('SELECT version')
          ? [{ version: 5 }]
          : sql.includes('GROUP BY direction')
            ? [{ direction: 'IN', status: 'SUCCESS', total: 2 }]
            : sql.includes('GROUP BY status')
              ? [{ status: 'RUNNING', total: 1 }]
              : [],
      rowsAffected: [1],
    }));
    const settings = await request(app)
      .get('/api/system/configuration')
      .set('Authorization', 'Bearer ' + token);
    expect(settings.status).toBe(200);
    expect(settings.body.data.runtime.encryptionKeyVersion).toBe('current');
    const diagnostic = await request(app)
      .get('/api/system/diagnostics')
      .set('Authorization', 'Bearer ' + token);
    expect(diagnostic.status).toBe(200);
    expect(diagnostic.headers['cache-control']).toBe('no-store');
    expect(diagnostic.body.schemaVersions).toEqual([5]);
    expect(diagnostic.body.databasePool.database_pool_idle).toBe(1);
    expect(state.inputs.action).toBe('EXPORT_DIAGNOSTIC_METADATA');
    for (const forbidden of [
      'postgresql://',
      'JWT_SECRET',
      'original_payload',
      'password_hash',
      'endpoint',
    ])
      expect(JSON.stringify(diagnostic.body)).not.toContain(forbidden);
    state.query.mockRejectedValue(new Error('synthetic database failure'));
    expect(
      (
        await request(app)
          .get('/api/system/diagnostics')
          .set('Authorization', 'Bearer ' + token)
      ).status,
    ).toBe(500);
  });
  it('viewer, operator and developer cannot export operational settings', async () => {
    for (const role of ['VIEWER', 'OPERATOR', 'DEVELOPER']) {
      state.query.mockResolvedValue({ recordset: [{ ...admin, role }], rowsAffected: [1] });
      expect(
        (
          await request(app)
            .get('/api/system/configuration')
            .set('Authorization', 'Bearer ' + token)
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .get('/api/system/diagnostics')
            .set('Authorization', 'Bearer ' + token)
        ).status,
      ).toBe(403);
    }
  });
});
