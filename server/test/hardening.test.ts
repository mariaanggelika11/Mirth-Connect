import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createCipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const state = vi.hoisted(() => ({
  query: vi.fn(),
  inputs: {} as Record<string, unknown>,
  history: [] as string[],
  send: vi.fn(),
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
  getConnection: async () => ({ request: requestMock }),
  withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ request: requestMock }),
}));
vi.mock('../src/utils/transport.js', () => ({
  sendRest: state.send,
  sendTcp: state.send,
  validateEndpoint: () => new URL('http://localhost'),
}));
import app from '../src/app.js';
import { config } from '../src/config/env.js';
import { signToken } from '../src/services/auth.services.js';
import { hashToken, sessionCookies } from '../src/services/session.services.js';
import { encrypt, decrypt } from '../src/utils/secrets.js';
import { maskPayload, safeLogRecord } from '../src/utils/masking.js';
import { encryptBackup, decryptBackup, restoreTarget } from '../src/utils/backup.js';
import { rotateSecrets } from '../src/services/rotation.services.js';
import { processInboundMessage } from '../src/services/messageProcessor.services.js';
import { channelSchema } from '../src/utils/validator.js';
import type { Response } from 'express';
const admin = { id: 1, name: 'Synthetic', role: 'ADMIN' },
  token = signToken(admin);
const configuration = channelSchema.parse({
  name: 'Synthetic',
  source: { type: 'HTTP', inboundDataType: 'JSON' },
  destinations: [],
});
beforeEach(() => {
  state.inputs = {};
  state.history = [];
  state.send.mockReset();
  state.query.mockResolvedValue({ recordset: [], rowsAffected: [1] });
});
describe('Browser session security', () => {
  const refresh = 'synthetic-refresh',
    csrf = 'synthetic-csrf';
  const row = {
    user_id: 1,
    name: 'Synthetic',
    role: 'ADMIN',
    family_id: 'synthetic-family',
    token_hash: hashToken(refresh),
    csrf_hash: hashToken(csrf),
    expires_at: new Date(Date.now() + 60000),
    used_at: null,
    revoked_at: null,
    created_at: new Date(),
    last_activity_at: new Date(),
  };
  it('rejects refresh without CSRF before database access', async () => {
    expect((await request(app).post('/api/auth/browser/refresh')).status).toBe(403);
    expect(state.query).not.toHaveBeenCalled();
  });
  it('rotates refresh once and returns short access token', async () => {
    state.query
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [row] })
      .mockResolvedValueOnce({ recordset: [row] })
      .mockResolvedValue({ recordset: [], rowsAffected: [1] });
    const res = await request(app)
      .post('/api/auth/browser/refresh')
      .set('Cookie', `mirth_refresh=${refresh}; mirth_csrf=${csrf}`)
      .set('X-CSRF-Token', csrf);
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie'].some((c: string) => c.includes('HttpOnly'))).toBe(true);
    expect(state.history.some((sql) => sql.includes('SET used_at'))).toBe(true);
    expect(state.inputs.token).not.toBe(refresh);
  });
  it('reuse revokes entire family and does not emit new token', async () => {
    state.query
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{ ...row, used_at: new Date() }] })
      .mockResolvedValueOnce({ recordset: [row] })
      .mockResolvedValue({ recordset: [], rowsAffected: [1] });
    const res = await request(app)
      .post('/api/auth/browser/refresh')
      .set('Cookie', `mirth_refresh=${refresh}; mirth_csrf=${csrf}`)
      .set('X-CSRF-Token', csrf);
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
    expect(state.inputs.action).toBe('REFRESH_REUSE');
    expect(state.history.some((sql) => sql.includes('revoked_at=COALESCE'))).toBe(true);
  });
  it('rejects expired, revoked and wrong-CSRF sessions', async () => {
    for (const invalid of [
      { ...row, expires_at: new Date(0) },
      { ...row, revoked_at: new Date() },
      { ...row, csrf_hash: hashToken('different') },
    ]) {
      state.query.mockResolvedValue({ recordset: [invalid] });
      expect(
        (
          await request(app)
            .post('/api/auth/browser/refresh')
            .set('Cookie', `mirth_refresh=${refresh}; mirth_csrf=${csrf}`)
            .set('X-CSRF-Token', csrf)
        ).status,
      ).toBe(401);
    }
  });
  it('logout revokes family and clears cookies', async () => {
    state.query.mockResolvedValue({ recordset: [row], rowsAffected: [1] });
    const res = await request(app)
      .post('/api/auth/browser/logout')
      .set('Cookie', `mirth_refresh=${refresh}; mirth_csrf=${csrf}`)
      .set('X-CSRF-Token', csrf);
    expect(res.status).toBe(200);
    expect(state.inputs.action).toBe('BROWSER_LOGOUT');
    expect(
      res.headers['set-cookie'].some((c: string) => c.includes('Expires=Thu, 01 Jan 1970')),
    ).toBe(true);
  });
  it('production cookies use Secure, HttpOnly, Strict and scoped path', () => {
    const production = config.production;
    config.production = true;
    const cookie = vi.fn(),
      set = vi.fn();
    try {
      sessionCookies({ cookie, set } as unknown as Response, 'refresh', 'csrf');
      expect(cookie.mock.calls[0][2]).toMatchObject({
        secure: true,
        httpOnly: true,
        sameSite: 'strict',
        path: '/api/auth/browser',
      });
    } finally {
      config.production = production;
    }
  });
});
describe('Revision and dry-run gates', () => {
  it('viewer cannot publish, rollback, reconcile or run scripts', async () => {
    state.query.mockResolvedValue({ recordset: [{ ...admin, role: 'VIEWER' }] });
    for (const route of [
      '/api/channel/1/revisions/2/publish',
      '/api/channel/1/revisions/2/rollback',
      '/api/channel/dry-run',
    ])
      expect(
        (
          await request(app)
            .post(route)
            .set('Authorization', 'Bearer ' + token)
            .send({})
        ).status,
      ).toBe(403);
    expect(
      (
        await request(app)
          .put('/api/message/1/reconciliation')
          .set('Authorization', 'Bearer ' + token)
          .send({})
      ).status,
    ).toBe(403);
  });
  it('publish rejects stale revision before mutating runtime configuration', async () => {
    state.query.mockImplementation(async (sql: string) => ({
      recordset: sql.includes('SELECT id,name,role')
        ? [admin]
        : sql.includes('SELECT id,active_revision')
          ? [{ id: 1, active_revision: 3 }]
          : [],
    }));
    const res = await request(app)
      .post('/api/channel/1/revisions/2/publish')
      .set('Authorization', 'Bearer ' + token)
      .send({ expectedActiveRevision: 1, changeSummary: 'Synthetic publish' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REVISION_CONFLICT');
    expect(state.history.some((sql) => sql.includes('SET name='))).toBe(false);
  });
  it('revision detail hides endpoint credentials and script contents', async () => {
    const secret = channelSchema.parse({
      ...configuration,
      processingScript: 'return "sensitive-script-value";',
      destinations: [
        {
          name: 'Synthetic',
          type: 'REST',
          endpoint: 'http://user:password@localhost/?token=secret-value',
        },
      ],
    });
    state.query.mockImplementation(async (sql: string) => ({
      recordset: sql.includes('SELECT id,name,role')
        ? [admin]
        : [{ configuration: encrypt(JSON.stringify(secret)), checksum: 'synthetic' }],
    }));
    const res = await request(app)
      .get('/api/channel/1/revisions/1')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('secret-value');
    expect(JSON.stringify(res.body)).not.toContain('sensitive-script-value');
  });
  it('dry-run returns transformed synthetic payload without transport side effects', async () => {
    state.query.mockResolvedValue({ recordset: [admin] });
    const res = await request(app)
      .post('/api/channel/dry-run?raw=true')
      .set('Authorization', 'Bearer ' + token)
      .send({
        configuration: {
          ...configuration,
          processingScript: 'msg.test=true;return msg;',
          destinations: [
            {
              name: 'Synthetic',
              type: 'REST',
              endpoint: 'http://localhost',
              outboundDataType: 'JSON',
            },
          ],
        },
        payload: { sample: 'synthetic' },
      });
    expect(res.status).toBe(200);
    expect(res.body.results[0].finalPayload).toEqual({ sample: 'synthetic', test: true });
    expect(state.send).not.toHaveBeenCalled();
  });
});
describe('Idempotency safety', () => {
  const channel = {
    id: 1,
    status: 'RUNNING',
    source_type: 'HTTP',
    inbound_data_type: 'JSON',
    idempotency_mode: 'OPTIONAL',
  };
  it('same key and payload reuses existing completed reservation', async () => {
    state.query.mockImplementation(async (sql: string) => ({
      recordset: sql.includes('SELECT * FROM "Channels"')
        ? [channel]
        : sql.includes('SELECT id,status,request_hash')
          ? [
              {
                id: 7,
                status: 'SUCCESS',
                request_hash: hashToken(JSON.stringify({ sample: 'synthetic' })),
              },
            ]
          : [],
    }));
    const result = await processInboundMessage(1, { sample: 'synthetic' }, 'correlation', 'key');
    expect(result.duplicate).toBe(true);
    expect(state.send).not.toHaveBeenCalled();
  });
  it('same key with changed payload conflicts', async () => {
    state.query.mockImplementation(async (sql: string) => ({
      recordset: sql.includes('SELECT * FROM "Channels"')
        ? [channel]
        : sql.includes('SELECT id,status,request_hash')
          ? [{ id: 7, status: 'SUCCESS', request_hash: hashToken('different') }]
          : [],
    }));
    await expect(
      processInboundMessage(1, { sample: 'synthetic' }, 'correlation', 'key'),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(state.send).not.toHaveBeenCalled();
  });
  it('required key and invalid key rejected', async () => {
    state.query.mockImplementation(async (sql: string) => ({
      recordset: sql.includes('SELECT * FROM "Channels"')
        ? [{ ...channel, idempotency_mode: 'REQUIRED' }]
        : [],
    }));
    await expect(processInboundMessage(1, {})).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    });
    await expect(processInboundMessage(1, {}, 'correlation', 'key\ninvalid')).rejects.toMatchObject(
      { code: 'INVALID_IDEMPOTENCY_KEY' },
    );
  });
});
describe('Secrets, PHI and backup safety', () => {
  it('reads historical v1 ciphertext and rejects wrong key IDs', () => {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', Buffer.from(config.encryptionKey, 'hex'), iv),
      body = Buffer.concat([cipher.update('synthetic-credential'), cipher.final()]);
    expect(
      decrypt('enc:v1:' + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')),
    ).toBe('synthetic-credential');
    expect(() => decrypt(encrypt('value').replace(':current:', ':unknown:'))).toThrow(
      'Encrypted configuration',
    );
  });
  it('masks clinical JSON and rejects PHI/credentials in structured records', () => {
    const raw = {
      patientName: 'Synthetic Patient',
      mrn: 'SYNTHETIC-MRN',
      nested: { token: 'test-token', password: 'test-password' },
    };
    const output = JSON.stringify(maskPayload(raw));
    for (const value of ['Synthetic Patient', 'SYNTHETIC-MRN', 'test-token', 'test-password'])
      expect(output).not.toContain(value);
    expect(safeLogRecord({ ...raw, messageId: 1, requestId: 'synthetic-id' })).toEqual({
      messageId: 1,
      requestId: 'synthetic-id',
    });
  });
  it('masks HL7 patient identifiers and text responses', () => {
    const output = String(
      maskPayload(
        'MSH|^~\\&|S|F|||20261014||ADT^A01|X|P|2.5\rPID|1||SYNTHETIC-MRN||PATIENT^SYNTHETIC',
      ),
    );
    expect(output).not.toContain('SYNTHETIC-MRN');
    expect(output).not.toContain('PATIENT^SYNTHETIC');
    expect(maskPayload('<Patient>synthetic</Patient>')).toBe('[REDACTED TEXT]');
  });
  it('rotation dry-run verifies without writes and failure propagates', async () => {
    state.query.mockResolvedValue({
      recordset: [{ id: 1, value: encrypt('synthetic') }],
      rowsAffected: [1],
    });
    // Plain endpoint-only fixtures for JSON snapshots must use valid JSON.
    state.query.mockImplementation(async (sql: string) => ({
      recordset:
        sql.includes('SELECT') && sql.includes(' value')
          ? [
              {
                id: 1,
                revision: 1,
                value: encrypt(
                  sql.includes('transport_config') || sql.includes('configuration')
                    ? '{}'
                    : 'synthetic',
                ),
              },
            ]
          : [],
    }));
    expect((await rotateSecrets(true)).recordsUpdated).toBe(0);
    expect(state.history.some((sql) => sql.startsWith('UPDATE'))).toBe(false);
    state.query.mockRejectedValue(new Error('database-failure'));
    await expect(rotateSecrets(false)).rejects.toThrow('database-failure');
  });
  it('restore refuses production, remote and unconfirmed targets', () => {
    for (const url of [
      'postgresql://localhost/production',
      'postgresql://remote/mirth_disposable_test',
    ])
      expect(() => restoreTarget(url, true)).toThrow();
    expect(() => restoreTarget('postgresql://localhost/mirth_disposable_test', false)).toThrow();
    expect(restoreTarget('postgresql://localhost/mirth_disposable_test', true)).toBe(
      'mirth_disposable_test',
    );
  });
  it('backup encryption round trips and fails checksum/authentication safely', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mirth-backup-test-'));
    try {
      const source = path.join(dir, 'source'),
        encrypted = path.join(dir, 'encrypted'),
        restored = path.join(dir, 'restored');
      await writeFile(source, 'synthetic database fixture');
      await encryptBackup(source, encrypted, 'b'.repeat(64));
      await decryptBackup(encrypted, restored, 'b'.repeat(64));
      expect(await readFile(restored, 'utf8')).toBe('synthetic database fixture');
      await expect(
        decryptBackup(encrypted, path.join(dir, 'wrong'), 'c'.repeat(64)),
      ).rejects.toThrow('BACKUP_DECRYPTION_FAILED');
      await writeFile(encrypted, 'tampered');
      await expect(
        decryptBackup(encrypted, path.join(dir, 'tampered'), 'b'.repeat(64)),
      ).rejects.toThrow('BACKUP_CHECKSUM_MISMATCH');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
