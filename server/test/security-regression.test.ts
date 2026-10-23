import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import { randomBytes } from 'node:crypto';
import type * as Processor from '../src/services/messageProcessor.services.js';

const state = vi.hoisted(() => ({
  query: vi.fn(),
  process: vi.fn(),
  inputs: {} as Record<string, unknown>,
  audits: [] as Record<string, unknown>[],
  role: 'ADMIN',
  key: '',
  revoked: new Set<string>(),
}));
const requestMock = () => ({
  input(key: string, value: unknown) {
    state.inputs[key] = value;
    return this;
  },
  query: state.query,
});
vi.mock('../src/config/db.js', () => ({
  getConnection: async () => ({ request: requestMock }),
  withTransaction: async (run: (tx: unknown) => Promise<unknown>) => run({ request: requestMock }),
}));
vi.mock('../src/services/messageProcessor.services.js', async (original) => ({
  ...(await original<typeof Processor>()),
  processInboundMessage: state.process,
}));
import app from '../src/app.js';
import { config, loadConfig } from '../src/config/env.js';
import { signToken } from '../src/services/auth.services.js';
import { encrypt } from '../src/utils/secrets.js';
import { logger } from '../src/utils/logger.js';

const token = () => signToken({ id: 1, name: 'Synthetic administrator', role: 'ADMIN' });
beforeEach(() => {
  state.inputs = {};
  state.audits = [];
  state.role = 'ADMIN';
  state.key = encrypt('synthetic-original-channel-key');
  state.revoked.clear();
  state.process.mockResolvedValue({ success: true, inboundStatus: 'SUCCESS' });
  state.query.mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT id,name,role')) {
      expect(sql).toContain('"RevokedTokens"');
      return {
        recordset: state.revoked.has(String(state.inputs.token))
          ? []
          : [{ id: 1, name: 'Synthetic administrator', role: state.role }],
      };
    }
    if (sql.includes('INSERT INTO "RevokedTokens"')) state.revoked.add(String(state.inputs.token));
    if (sql.includes('SET source_api_key=')) state.key = String(state.inputs.key);
    if (sql.includes('INSERT INTO "AuditLog"')) state.audits.push({ ...state.inputs });
    if (sql.includes('SELECT source_api_key'))
      return { recordset: [{ source_api_key: state.key }] };
    if (sql.includes('SELECT source_type,inbound_data_type'))
      return { recordset: [{ source_type: 'HTTP', inbound_data_type: 'JSON' }] };
    if (sql.includes('SELECT c.*'))
      return { recordsets: [[{ id: 1, source_type: 'HTTP', source_api_key: state.key }], []] };
    if (sql.includes('SELECT m.*'))
      return {
        recordset: [
          {
            id: 1,
            channel_id: 1,
            direction: 'IN',
            status: 'SUCCESS',
            original_payload: JSON.stringify({
              patientName: 'Synthetic Private Patient',
              token: 'synthetic-private-token',
            }),
            transformed_payload: JSON.stringify({ mrn: 'SYNTHETIC-PRIVATE-MRN' }),
            correlation_id: 'synthetic-correlation',
          },
        ],
      };
    if (sql.includes('FROM "MessageDestinationLog"'))
      return {
        recordset: [
          {
            message_id: 2,
            message_control_id: 'SYNTHETIC-CONTROL-ID',
            request_data: '{"patientName":"Synthetic Private Patient"}',
            outbound_data: 'MSH|^~\\&|SYNTHETIC',
            response_text: 'Synthetic receiver response',
          },
        ],
      };
    return { recordset: [], rowsAffected: [1] };
  });
});

describe('Security enforcement survives UI simplification', () => {
  it.each([undefined, 'synthetic-invalid-key'])(
    'rejects absent/invalid source API key (%s) before processing',
    async (key) => {
      const call = request(app).post('/api/inbound/1');
      if (key) call.set('X-API-Key', key);
      const response = await call.send({ fixture: true });
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('CONNECTOR_UNAUTHORIZED');
      expect(state.process).not.toHaveBeenCalled();
    },
  );
  it('rotates encrypted keys, rejects old credentials, audits metadata and never lists the key', async () => {
    const rotated = await request(app)
      .put('/api/channel/1/credential')
      .set('Authorization', 'Bearer ' + token());
    expect(rotated.status).toBe(200);
    expect(rotated.headers['cache-control']).toBe('no-store');
    const key = rotated.body.data.apiKey;
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(state.key).toMatch(/^enc:v2:/);
    expect(state.key).not.toContain(key);
    for (const path of ['/api/inbound/1', '/api/message/inbound/1']) {
      const old = await request(app)
        .post(path)
        .set('X-API-Key', 'synthetic-original-channel-key')
        .send({ fixture: true });
      expect(old.status).toBe(401);
      const valid = await request(app).post(path).set('X-API-Key', key).send({ fixture: true });
      expect(valid.status).toBe(200);
    }
    const listed = await request(app)
      .get('/api/channel')
      .set('Authorization', 'Bearer ' + token());
    expect(listed.status).toBe(200);
    expect(listed.body[0].apiKeyConfigured).toBe(true);
    expect(JSON.stringify(listed.body)).not.toContain(key);
    expect(state.audits[0]).toMatchObject({ action: 'ROTATE_CONNECTOR_KEY', resourceId: 1 });
    // The SQL audit interface accepts metadata only, even if request binding also contains ciphertext.
    const auditSql = state.query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO "AuditLog"'),
    )![0];
    expect(auditSql).not.toContain('@key');
    expect(JSON.stringify(state.audits)).not.toContain(key);
    expect(state.process.mock.calls.every((args) => !JSON.stringify(args).includes(key))).toBe(
      true,
    );
  });
  it('revoked JWT cannot be reused after logout', async () => {
    const authorization = 'Bearer ' + token();
    expect(
      (await request(app).post('/api/auth/logout').set('Authorization', authorization)).status,
    ).toBe(200);
    expect(
      (await request(app).get('/api/channel').set('Authorization', authorization)).status,
    ).toBe(401);
  });
  it('production never accepts the development global key for an unconfigured channel', async () => {
    const previous = config.production;
    state.key = '';
    config.production = true;
    try {
      const response = await request(app)
        .post('/api/inbound/1')
        .set('X-API-Key', config.inbound.apiKey)
        .send({ fixture: true });
      expect(response.status).toBe(401);
      expect(state.process).not.toHaveBeenCalled();
    } finally {
      config.production = previous;
    }
  });
  it.each(['VIEWER', 'OPERATOR', 'DEVELOPER'])(
    '%s cannot request raw message payload',
    async (role) => {
      state.role = role;
      const response = await request(app)
        .get('/api/message/1?raw=true')
        .set('Authorization', 'Bearer ' + token());
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('RAW_PAYLOAD_DENIED');
      expect(JSON.stringify(response.body)).not.toContain('Synthetic Private Patient');
    },
  );
  it('operator cannot manage users or rotate source keys', async () => {
    state.role = 'OPERATOR';
    expect(
      (
        await request(app)
          .get('/api/users')
          .set('Authorization', 'Bearer ' + token())
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .put('/api/channel/1/credential')
          .set('Authorization', 'Bearer ' + token())
      ).status,
    ).toBe(403);
    expect(state.audits).toEqual([]);
  });
  it('redacts default payload and audits explicit raw access before returning data', async () => {
    const masked = await request(app)
      .get('/api/message/1')
      .set('Authorization', 'Bearer ' + token());
    expect(masked.status).toBe(200);
    expect(masked.body.data.destinationLogs[0].messageControlId).toBe('[REDACTED]');
    for (const value of [
      'Synthetic Private Patient',
      'synthetic-private-token',
      'SYNTHETIC-PRIVATE-MRN',
    ])
      expect(JSON.stringify(masked.body)).not.toContain(value);
    const raw = await request(app)
      .get('/api/message/1?raw=true')
      .set('Authorization', 'Bearer ' + token());
    expect(raw.status).toBe(200);
    expect(raw.body.data.originalPayload.patientName).toBe('Synthetic Private Patient');
    expect(raw.body.data.destinationLogs[0]).toMatchObject({
      messageControlId: 'SYNTHETIC-CONTROL-ID',
      requestData: { patientName: 'Synthetic Private Patient' },
      outboundData: 'MSH|^~\\&|SYNTHETIC',
      responseText: 'Synthetic receiver response',
    });
    expect(state.audits.at(-1)).toMatchObject({
      action: 'VIEW_MESSAGE_RAW',
      resourceId: 1,
      requestId: raw.headers['x-request-id'],
    });
    const originalQuery = state.query.getMockImplementation()!;
    state.query.mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO "AuditLog"'))
        throw new Error('Synthetic private database detail');
      return originalQuery(sql);
    });
    const failedAudit = await request(app)
      .get('/api/message/1?raw=true')
      .set('Authorization', 'Bearer ' + token());
    expect(failedAudit.status).toBe(500);
    expect(JSON.stringify(failedAudit.body)).not.toContain('Synthetic Private');
  });
  it('real structured logger excludes patient data, credentials, headers and errors', () => {
    const stream = (logger as unknown as Record<symbol, { write: (line: string) => void }>)[
      pino.symbols.streamSym
    ];
    const write = vi.spyOn(stream, 'write').mockImplementation(() => {});
    const previous = logger.level;
    try {
      logger.level = 'info';
      logger.info(
        {
          requestId: 'synthetic-id',
          payload: { name: 'Synthetic Private Patient' },
          password: 'synthetic-private-password',
          headers: { 'x-api-key': 'synthetic-private-key' },
          err: new Error('synthetic-private-error'),
        },
        'Security regression event',
      );
      expect(write).toHaveBeenCalledOnce();
      const line = String(write.mock.calls[0][0]);
      expect(line).toContain('synthetic-id');
      for (const value of [
        'Synthetic Private Patient',
        'synthetic-private-password',
        'synthetic-private-key',
        'synthetic-private-error',
      ])
        expect(line).not.toContain(value);
    } finally {
      logger.level = previous;
      write.mockRestore();
    }
  });
  it('rate-limits repeated failed login before further database lookups', async () => {
    let response;
    for (let i = 0; i < 21; i++)
      response = await request(app).post('/api/auth/login').send({
        username: 'synthetic-unknown-user',
        password: 'synthetic-wrong-password',
      });
    expect(response!.status).toBe(429);
    expect(response!.headers['retry-after']).toBeDefined();
    expect(response!.body.code).toBe('RATE_LIMITED');
    expect(state.query.mock.calls.length).toBeGreaterThan(0);
    const lookups = state.query.mock.calls.length;
    expect((await request(app).post('/api/auth/login').send({})).status).toBe(429);
    expect(state.query.mock.calls).toHaveLength(lookups);
  });
  it('rate-limits invalid source keys before further channel lookups', async () => {
    let response;
    for (let i = 0; i < 61; i++)
      response = await request(app).post('/api/inbound/1').set('X-API-Key', 'invalid').send({});
    expect(response!.status).toBe(429);
    const lookups = state.query.mock.calls.length;
    expect((await request(app).post('/api/inbound/1').send({})).status).toBe(429);
    expect(state.query.mock.calls).toHaveLength(lookups);
    expect(state.process).not.toHaveBeenCalled();
  });
});

describe('Production secrets', () => {
  const environment = () => ({
    ...process.env,
    NODE_ENV: 'production',
    PG_SSL: 'true',
    PG_SSL_REJECT_UNAUTHORIZED: 'true',
    PUBLIC_BASE_URL: 'https://connect.example.invalid',
    HL7_ENABLED: 'false',
    OUTBOUND_ALLOWED_HOSTS: 'receiver.example.invalid',
    JWT_SECRET: randomBytes(32).toString('hex'),
    CONFIG_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  });
  it('accepts independent generated secrets and rejects missing/example/repeated keys without echoing them', () => {
    expect(loadConfig(environment()).production).toBe(true);
    for (const patch of [
      { JWT_SECRET: '' },
      { JWT_SECRET: 'synthetic-test-only-jwt-key-longer-than-32' },
      { JWT_SECRET: 'x'.repeat(64) },
      { CONFIG_ENCRYPTION_KEY: '' },
      { CONFIG_ENCRYPTION_KEY: 'ab'.repeat(32) },
    ]) {
      expect(() => loadConfig({ ...environment(), ...patch })).toThrow();
    }
    expect(config.production).toBe(false);
  });
});
