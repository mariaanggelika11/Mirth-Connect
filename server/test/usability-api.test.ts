import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import type * as MessageProcessor from '../src/services/messageProcessor.services.js';
const state = vi.hoisted(() => ({
  query: vi.fn(),
  process: vi.fn(),
  inputs: {} as Record<string, unknown>,
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
  ...(await original<typeof MessageProcessor>()),
  processInboundMessage: state.process,
}));
import app from '../src/app.js';
import { config, loadConfig } from '../src/config/env.js';
import { signToken } from '../src/services/auth.services.js';
import { channelSchema } from '../src/utils/validator.js';
import { encrypt } from '../src/utils/secrets.js';
import { runConfiguration } from '../src/services/dryRun.services.js';
import { logRow, sourceMetadata } from '../src/services/monitor/mapping.js';
import type { DestinationLogRow, MonitorRow } from '../src/services/monitor/mapping.js';
import { withConnectionProbe } from '../src/services/connectionProbe.services.js';
import { sample } from './fixtures.js';

const token = signToken({ id: 1, name: 'Synthetic administrator', role: 'ADMIN' });
const admin = { id: 1, name: 'Synthetic administrator', role: 'ADMIN' };
const configuration = (outboundDataType = 'XML', inboundDataType = 'JSON') =>
  channelSchema.parse({
    name: 'Synthetic conversion',
    source: { type: 'HTTP', inboundDataType },
    destinations: [
      {
        name: 'Synthetic destination',
        type: 'REST',
        endpoint: 'http://localhost',
        outboundDataType,
      },
    ],
  });
const servers: net.Server[] = [];
const sockets = new Set<net.Socket>();
beforeEach(() => {
  state.inputs = {};
  state.process.mockResolvedValue({ success: true, inboundStatus: 'SUCCESS' });
  state.query.mockImplementation(async (sql: string) => ({
    recordset: sql.includes('SELECT id,name,role')
      ? [admin]
      : sql.includes('SELECT source_type,inbound_data_type')
        ? [{ source_type: 'HTTP', inbound_data_type: 'JSON', active_revision: 1 }]
        : sql.includes('SELECT source_api_key')
          ? [{ source_api_key: encrypt('synthetic-channel-key') }]
          : [],
  }));
});
afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((r) => server.close(() => r()))),
  );
});

describe('Authoritative source URLs and legacy inbound compatibility', () => {
  const environment = () => ({
    ...process.env,
    PUBLIC_BASE_URL: '',
    INBOUND_BASE_URL: '',
    INBOUND_PATH: undefined,
  });
  const production = () => ({
    ...environment(),
    NODE_ENV: 'production',
    PG_SSL: 'true',
    OUTBOUND_ALLOWED_HOSTS: 'receiver.example',
    HL7_ENABLED: 'false',
    JWT_SECRET: randomBytes(32).toString('hex'),
    CONFIG_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  });
  it('uses localhost locally and explicit public HTTPS behind a production proxy', () => {
    expect(loadConfig(environment()).inbound).toMatchObject({
      baseUrl: 'http://localhost:9000',
      path: '/api/message/inbound',
    });
    expect(
      loadConfig({ ...production(), PUBLIC_BASE_URL: 'https://connect.bulmar.tech/' }).inbound
        .baseUrl,
    ).toBe('https://connect.bulmar.tech');
    expect(
      loadConfig({ ...production(), INBOUND_BASE_URL: 'https://legacy.example/prefix/' }).inbound
        .baseUrl,
    ).toBe('https://legacy.example/prefix');
    expect(
      loadConfig({
        ...production(),
        PUBLIC_BASE_URL: 'https://connect.bulmar.tech',
        INBOUND_BASE_URL: 'http://localhost:9000',
      }).inbound.baseUrl,
    ).toBe('https://connect.bulmar.tech');
    expect(
      loadConfig({
        ...environment(),
        INBOUND_BASE_URL: 'http://localhost:9100',
        INBOUND_PATH: '/api/inbound',
      }).inbound,
    ).toMatchObject({ baseUrl: 'http://localhost:9100', path: '/api/inbound' });
  });
  it('rejects missing, localhost, plaintext, credential-bearing or query-bearing production URLs', () => {
    expect(() => loadConfig(production())).toThrow('PUBLIC_BASE_URL');
    for (const url of [
      'http://connect.bulmar.tech',
      'https://localhost',
      'https://user:secret@connect.bulmar.tech',
      'https://connect.bulmar.tech?token=synthetic',
      'ftp://connect.bulmar.tech',
    ])
      expect(() => loadConfig({ ...production(), PUBLIC_BASE_URL: url })).toThrow(
        'PUBLIC_BASE_URL',
      );
  });
  it('returns source configuration to the wizard without guessing browser host', async () => {
    const response = await request(app)
      .get('/api/channel/source-configuration')
      .set('Authorization', 'Bearer ' + token);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      baseUrl: config.inbound.baseUrl,
      path: config.inbound.path,
    });
  });
  it('replaces historical localhost display URLs without editing stored channel data', async () => {
    const previous = config.inbound.baseUrl;
    config.inbound.baseUrl = 'https://connect.bulmar.tech';
    state.query.mockImplementation(async (sql: string) =>
      sql.includes('SELECT id,name,role')
        ? { recordset: [admin] }
        : {
            recordsets: [
              [
                {
                  id: 7,
                  source_type: 'HTTP',
                  source_endpoint: 'http://localhost:9000/api/inbound/7',
                },
              ],
              [],
            ],
          },
    );
    try {
      const response = await request(app)
        .get('/api/channel')
        .set('Authorization', 'Bearer ' + token);
      expect(response.status).toBe(200);
      expect(response.body[0].source.endpoint).toBe(
        'https://connect.bulmar.tech' + config.inbound.path + '/7',
      );
      expect(state.query.mock.calls.some(([sql]) => sql.includes('UPDATE '))).toBe(false);
    } finally {
      config.inbound.baseUrl = previous;
    }
  });
  it('accepts channel API keys at both paths and preserves existing management bearer automation', async () => {
    for (const path of ['/api/inbound/7', '/api/message/inbound/7']) {
      const response = await request(app)
        .post(path)
        .set('X-API-Key', 'synthetic-channel-key')
        .send({ fixture: true });
      expect(response.status).toBe(200);
      expect(state.process).toHaveBeenLastCalledWith(
        7,
        { fixture: true },
        expect.any(String),
        undefined,
        'HTTP',
        1,
      );
    }
    const bearer = await request(app)
      .post('/api/message/inbound/7')
      .set('Authorization', 'Bearer ' + token)
      .send({ fixture: true });
    expect(bearer.status).toBe(200);
  });
  it('adds simple response aliases while retaining the complete legacy result', async () => {
    const legacyResult = {
      success: true,
      inboundMessageId: 42,
      inboundStatus: 'SUCCESS',
      response: 'SYNTHETIC LEGACY SOURCE RESPONSE',
      outboundResults: [{ destinationId: 9, status: 'OUT-SENT' }],
    };
    state.process.mockResolvedValue(legacyResult);
    const response = await request(app)
      .post('/api/message/inbound/7')
      .set('X-API-Key', 'synthetic-channel-key')
      .send({ fixture: true });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      messageId: 42,
      status: 'SUCCESS',
      result: legacyResult,
    });
  });
  for (const inboundStatus of ['FAILED', 'PARTIAL', 'IN-ERROR'])
    it(`returns the safe error contract for persisted ${inboundStatus} without changing legacy results`, async () => {
      const legacyResult = {
        success: false,
        inboundMessageId: 42,
        inboundStatus,
        response: 'Synthetic legacy source response',
        outboundResults: [{ destinationId: 9, status: 'OUT-ERROR' }],
      };
      state.process.mockResolvedValue(legacyResult);
      const response = await request(app)
        .post('/api/message/inbound/7')
        .set('X-API-Key', 'synthetic-channel-key')
        .send({ name: 'SYNTHETIC-PRIVATE-PATIENT' });
      expect(response.status).toBe(502);
      expect(response.body).toEqual({
        success: false,
        messageId: 42,
        status: inboundStatus,
        code: 'MESSAGE_PROCESSING_FAILED',
        message: 'Message processing did not complete successfully.',
        requestId: response.headers['x-request-id'],
        details: [],
        result: legacyResult,
      });
      expect(response.body.requestId).toEqual(expect.any(String));
      expect(response.body.message).not.toContain('SYNTHETIC-PRIVATE');
    });
  for (const [inboundStatus, expectedStatus] of [
    ['FILTERED', 200],
    ['QUEUED', 202],
  ] as const)
    it(`preserves the successful ${inboundStatus} envelope without error fields`, async () => {
      const legacyResult = {
        success: true,
        inboundMessageId: 42,
        inboundStatus,
        outboundResults: [],
      };
      state.process.mockResolvedValue(legacyResult);
      const response = await request(app)
        .post('/api/message/inbound/7')
        .set('X-API-Key', 'synthetic-channel-key')
        .send({ fixture: true });
      expect(response.status).toBe(expectedStatus);
      expect(response.body).toEqual({
        success: true,
        messageId: 42,
        status: inboundStatus,
        result: legacyResult,
      });
    });
  it('rejects malformed JSON before the engine and accepts parsed string scalars', async () => {
    const invalid = await request(app)
      .post('/api/message/inbound/7')
      .set('X-API-Key', 'synthetic-channel-key')
      .set('Content-Type', 'application/json')
      .send('{"SYNTHETIC-PRIVATE":');
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe('INVALID_JSON');
    expect(state.process).not.toHaveBeenCalled();
    expect(JSON.stringify(invalid.body)).not.toContain('SYNTHETIC-PRIVATE');
    const scalar = await request(app)
      .post('/api/message/inbound/7')
      .set('X-API-Key', 'synthetic-channel-key')
      .set('Content-Type', 'application/json')
      .send('"valid scalar"');
    expect(scalar.status).toBe(200);
    expect(state.process).toHaveBeenLastCalledWith(
      7,
      'valid scalar',
      expect.any(String),
      undefined,
      'HTTP',
      1,
    );
  });
});

describe('Explicit destination connection probes', () => {
  it('performs a TCP handshake with no patient payload or HTTP request, then audits metadata only', async () => {
    let bytes = 0;
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('data', (data) => {
        bytes += data.length;
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const endpoint = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/?token=synthetic-secret`;
    const response = await request(app)
      .post('/api/channel/test-connection')
      .set('Authorization', 'Bearer ' + token)
      .send({ type: 'REST', endpoint });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      reachable: true,
      probe: 'TCP_HANDSHAKE',
      applicationDeliveryTested: false,
    });
    expect(response.body.httpStatus).toBeUndefined();
    expect(bytes).toBe(0);
    expect(state.inputs.action).toBe('TEST_UNSAVED_DESTINATION_CONNECTION');
    expect(JSON.stringify(state.inputs)).not.toContain('synthetic-secret');
  });
  it('rejects viewers, metadata destinations, nonallowlisted hosts and patient-body fields', async () => {
    for (const endpoint of ['http://169.254.169.254', 'http://other.example']) {
      const response = await request(app)
        .post('/api/channel/test-connection')
        .set('Authorization', 'Bearer ' + token)
        .send({ type: 'REST', endpoint });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('DESTINATION_HOST_DENIED');
    }
    expect(
      (
        await request(app)
          .post('/api/channel/test-connection')
          .set('Authorization', 'Bearer ' + token)
          .send({ type: 'REST', endpoint: 'http://localhost', payload: { patient: 'synthetic' } })
      ).status,
    ).toBe(400);
    state.query.mockResolvedValue({ recordset: [{ ...admin, role: 'VIEWER' }] });
    expect(
      (
        await request(app)
          .post('/api/channel/test-connection')
          .set('Authorization', 'Bearer ' + token)
          .send({ type: 'REST', endpoint: 'http://localhost' })
      ).status,
    ).toBe(403);
  });
  it('shares a bounded probe budget and releases capacity after completion or failure', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const probes = Array.from({ length: 4 }, () => withConnectionProbe(() => pending));
    await expect(withConnectionProbe(async () => true)).rejects.toMatchObject({
      code: 'CONNECTION_TEST_CAPACITY',
    });
    release();
    await Promise.all(probes);
    await expect(
      withConnectionProbe(async () => {
        throw new Error('synthetic');
      }),
    ).rejects.toThrow('synthetic');
    await expect(withConnectionProbe(async () => true)).resolves.toBe(true);
  });
});

describe('Dry-run source processing and final outbound preview', () => {
  it.each([
    ['JSON', 'XML', { Patient: { fixture: 'SYNTHETIC' } }, '<Patient>'],
    [
      'XML',
      'JSON',
      '<Patient><fixture>SYNTHETIC</fixture></Patient>',
      { Patient: { fixture: 'SYNTHETIC' } },
    ],
    ['HL7V2', 'JSON', sample, expect.objectContaining({ MSH: expect.anything() })],
  ])(
    '%s to %s follows real conversion without modifying input',
    async (inputFormat, finalFormat, payload, expected) => {
      const result = await runConfiguration(
        configuration(String(finalFormat), String(inputFormat)),
        payload,
      );
      expect(result.networkDelivery).toBe('NOT_SENT');
      expect(result.source.transformation).toBe('PASS_THROUGH');
      expect(result.input.payload).toEqual(payload);
      expect(result.source.payload).toEqual(payload);
      if (typeof expected === 'string') expect(result.results[0].finalPayload).toContain(expected);
      else expect(result.results[0].finalPayload).toEqual(expected);
      expect(result.results[0]).toMatchObject({
        outputFormat: finalFormat,
        stages: { conversion: 'CONVERTED' },
      });
    },
  );
  it('converts parsed HL7 JSON back into HL7, and reports filtering or safe conversion failures', async () => {
    const json = (await runConfiguration(configuration('JSON', 'HL7V2'), sample)).results[0]
      .finalPayload;
    const result = await runConfiguration(configuration('HL7V2'), json);
    expect(result.results[0].finalPayload).toContain('MSH|');
    const filtered = await runConfiguration(
      { ...configuration(), filterScript: 'return false;' },
      { fixture: true },
    );
    expect(filtered.source).toMatchObject({ filter: 'FILTERED', transformation: 'SKIPPED' });
    expect(filtered.results[0].finalPayload).toBeUndefined();
    const invalid = await runConfiguration(configuration('HL7V2'), {
      patientName: 'Synthetic private name',
    });
    expect(invalid.success).toBe(false);
    expect(invalid.results[0]).toMatchObject({ status: 'ERROR', stages: { conversion: 'ERROR' } });
    expect(JSON.stringify(invalid.results)).not.toContain('Synthetic private name');
  });
  it('reports the failed source stage without leaking script exceptions or calling destinations', async () => {
    for (const [field, stage] of [
      ['filterScript', 'filter'],
      ['processingScript', 'transformation'],
    ] as const) {
      const result = await runConfiguration(
        { ...configuration(), [field]: 'throw new Error("synthetic-private-error");' },
        {},
      );
      expect(result.success).toBe(false);
      expect(result.source[stage]).toBe('ERROR');
      expect(result.source.code).toBe('SCRIPT_EXECUTION_FAILED');
      expect(result.results).toEqual([]);
      expect(JSON.stringify(result)).not.toContain('synthetic-private-error');
    }
    const invalidXml = await runConfiguration(configuration('JSON', 'XML'), '<Invalid>');
    expect(invalidXml.source).toMatchObject({
      validation: 'ERROR',
      filter: 'SKIPPED',
      code: 'XML_INVALID',
    });
  });
  it('masks each preview payload by default; explicit administrator raw preview is audited', async () => {
    const body = {
      configuration: configuration(),
      payload: { Patient: { patientName: 'Synthetic Patient' } },
    };
    const response = await request(app)
      .post('/api/channel/dry-run')
      .set('Authorization', 'Bearer ' + token)
      .send(body);
    expect(response.status).toBe(200);
    expect(response.body.results[0].finalPayload).toBe('[REDACTED TEXT]');
    expect(response.body.source.payload.Patient).toBe('[REDACTED]');
    expect(JSON.stringify(response.body)).not.toContain('Synthetic Patient');
    const raw = await request(app)
      .post('/api/channel/dry-run')
      .set('Authorization', 'Bearer ' + token)
      .send({ ...body, raw: true });
    expect(raw.status).toBe(200);
    expect(raw.body.rawPayload).toBe(true);
    expect(raw.body.results[0].finalPayload).toContain(
      '<patientName>Synthetic Patient</patientName>',
    );
    expect(state.inputs.action).toBe('DRY_RUN_CONFIGURATION_RAW');
    expect(state.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO "Messages"'))).toBe(
      false,
    );
    state.query.mockResolvedValue({ recordset: [{ ...admin, role: 'DEVELOPER' }] });
    expect(
      (
        await request(app)
          .post('/api/channel/dry-run')
          .set('Authorization', 'Bearer ' + token)
          .send({ ...body, raw: true })
      ).status,
    ).toBe(403);
  });
});

describe('Immutable message processing metadata', () => {
  it('reads format and transformer presence from captured revisions and destination snapshots', () => {
    expect(
      sourceMetadata({
        direction: 'OUT',
        message_type: 'XML',
        inbound_format: 'JSON',
        revision_configuration: encrypt(JSON.stringify({ processingScript: '' })),
      } as MonitorRow),
    ).toEqual({ inboundFormat: 'JSON', sourceTransformed: false });
    const row = logRow(
      {
        destination_name: 'Live name changed',
        transport_config: encrypt(
          JSON.stringify({
            name: 'Captured name',
            type: 'REST',
            outbound_data_type: 'XML',
            endpoint: 'http://user:secret@localhost',
          }),
        ),
      } as DestinationLogRow,
      false,
    );
    expect(row).toMatchObject({
      destinationName: 'Captured name',
      outboundFormat: 'XML',
      connectorType: 'REST',
      snapshotCaptured: true,
    });
    expect(JSON.stringify(row)).not.toContain('secret');
    expect(row).not.toHaveProperty('responseStatusCode');
  });
  it('leaves legacy or unreadable snapshot metadata unknown instead of guessing from current configuration', () => {
    expect(
      sourceMetadata({
        direction: 'OUT',
        message_type: 'XML',
        revision_configuration: 'enc:invalid',
      } as MonitorRow),
    ).toEqual({ inboundFormat: undefined, sourceTransformed: undefined });
    expect(
      logRow({ destination_name: 'Legacy destination' } as DestinationLogRow, false),
    ).toMatchObject({ destinationName: 'Legacy destination', snapshotCaptured: false });
    expect(
      logRow({ transport_config: 'enc:invalid' } as DestinationLogRow, false).outboundFormat,
    ).toBeUndefined();
  });
});
