import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import net from 'node:net';
import type * as Transport from '../src/utils/transport.js';

const state = vi.hoisted(() => ({
  query: vi.fn(),
  send: vi.fn(),
  probe: vi.fn(),
  lookup: vi.fn(),
  writes: [] as { sql: string; inputs: Record<string, unknown> }[],
  lastError: '',
  inboundPayload: '',
  inboundStatus: '',
}));
const databaseRequest = () => {
  const inputs: Record<string, unknown> = {};
  return {
    input(key: string, value: unknown) {
      inputs[key] = value;
      return this;
    },
    query(sql: string) {
      state.writes.push({ sql, inputs: { ...inputs } });
      return state.query(sql, inputs);
    },
  };
};
vi.mock('../src/config/db.js', () => ({
  getConnection: async () => ({ request: databaseRequest }),
  withTransaction: async (run: (tx: unknown) => Promise<unknown>) =>
    run({ request: databaseRequest }),
}));
vi.mock('../src/utils/transport.js', async (original) => ({
  ...(await original<typeof Transport>()),
  sendRest: state.send,
  sendTcp: state.send,
  testConnection: state.probe,
}));
vi.mock('node:dns/promises', () => ({
  default: { lookup: state.lookup },
  lookup: state.lookup,
}));

import app from '../src/app.js';
import { processInboundMessage } from '../src/services/messageProcessor.services.js';
import { runConfiguration } from '../src/services/dryRun.services.js';
import { validatePayload } from '../src/services/profileValidation.services.js';
import { signToken } from '../src/services/auth.services.js';
import { channelSchema } from '../src/utils/validator.js';
import { compileFieldMapping } from '../src/utils/fieldMapping.js';
import { compileSimpleCondition } from '../src/utils/simpleCondition.js';
import { encrypt } from '../src/utils/secrets.js';
import { logger } from '../src/utils/logger.js';
import { config } from '../src/config/env.js';
import { startHl7Listener, stopHl7Listener } from '../src/services/hl7Listener.services.js';
import { MllpDecoder, frame } from '../src/utils/mllp.js';
import { sample } from './fixtures.js';
import type {
  FieldRule,
  ValidationRuleResult,
  ValidationSettings,
} from '../src/utils/validationRules.js';

const apiKey = 'synthetic-field-validation-source-key';
const fieldRules: FieldRule[] = [
  { field: 'patient_id', type: 'text', required: true, minLength: 1, maxLength: 40 },
  { field: 'name', type: 'text', required: true },
  { field: 'gender', type: 'text', required: true, allowedValues: ['M', 'F', 'O'] },
  { field: 'date_of_birth', type: 'date', required: true },
];
const validationProfile = (): ValidationSettings => ({
  version: 1,
  mode: 'FIELDS',
  fieldRules: structuredClone(fieldRules),
  custom: {},
});
const payload = () => ({
  patient_id: 'SYNTHETIC-PRIVATE-ID',
  name: 'Synthetic Private Patient',
  gender: 'F',
  date_of_birth: '2000-02-29',
});
const mapping = compileFieldMapping({
  version: 1,
  rootElement: 'Patient',
  rows: [
    { source: 'patient_id', target: 'PatientID', required: true },
    { source: 'name', target: 'PatientName', required: true },
    { source: 'gender', target: 'Gender', required: true },
    { source: 'date_of_birth', target: 'BirthDate', required: true },
  ],
});
const destination = {
  id: 2,
  channel_id: 1,
  name: 'Synthetic XML receiver',
  type: 'REST',
  endpoint: 'http://localhost/synthetic-validation',
  outbound_data_type: 'XML',
  is_enabled: true,
  is_deleted: false,
  processing_script: '',
  response_script: '',
  template_script: '',
  filter_script: '',
  retry_enabled: true,
  max_retries: 3,
  retry_interval_seconds: 1,
  timeout_ms: 1000,
};
function database(
  profile: Record<string, unknown> | ValidationSettings = validationProfile(),
  filter = '',
  processing = mapping,
  source: 'HTTP' | 'HL7' = 'HTTP',
) {
  const channel = {
    id: 1,
    status: 'RUNNING',
    active_revision: 7,
    source_type: source,
    source_api_key: encrypt(apiKey),
    inbound_data_type: source === 'HL7' ? 'HL7V2' : 'JSON',
    processing_script: processing,
    filter_script: filter,
    validation_profile: JSON.stringify(profile),
  };
  state.query.mockImplementation(async (sql: string, inputs: Record<string, unknown>) => {
    if (sql.includes('SELECT id,name,role'))
      return { recordset: [{ id: 1, name: 'Synthetic administrator', role: 'ADMIN' }] };
    if (
      sql.includes('SELECT * FROM "Channels"') ||
      sql.includes('SELECT source_api_key') ||
      sql.includes('SELECT source_type,inbound_data_type') ||
      sql.includes('SELECT id,filter_script,active_revision')
    )
      return { recordset: [channel], rowsAffected: [1] };
    if (sql.includes('SELECT * FROM "Destinations"'))
      return { recordset: [destination], rowsAffected: [1] };
    if (sql.includes('INSERT INTO "Messages"') && sql.includes("'IN'")) {
      state.inboundPayload = String(inputs.payload);
      state.inboundStatus = 'IN-PROCESS';
      return { recordset: [{ id: 4 }], rowsAffected: [1] };
    }
    if (sql.includes("status='IN-ERROR'")) {
      state.lastError = String(inputs.error);
      state.inboundStatus = 'IN-ERROR';
    }
    if (sql.includes("status='FILTERED'")) state.inboundStatus = 'FILTERED';
    if (sql.includes('INSERT INTO "Messages"') && sql.includes("'OUT'"))
      return {
        recordset: [
          {
            id: 5,
            channel_id: 1,
            destination_id: 2,
            inbound_message_id: 4,
            status: 'PROCESSING',
            retry_count: 0,
            correlation_id: inputs.correlation,
            original_payload: inputs.payload,
            transformed_payload: inputs.payload,
            transport_config: inputs.snapshot,
          },
        ],
        rowsAffected: [1],
      };
    if (sql.includes('SELECT status FROM "Messages"'))
      return { recordset: [{ status: 'OUT-SENT' }], rowsAffected: [1] };
    if (sql.includes('SELECT m.*'))
      return {
        recordset: [
          {
            id: 4,
            channel_id: 1,
            channel_name: 'Synthetic validated integration',
            channel_revision: 7,
            message_type: 'JSON',
            direction: 'IN',
            status: state.inboundStatus,
            last_error: state.lastError,
            original_payload: state.inboundPayload,
            correlation_id: 'synthetic-validation-correlation',
          },
        ],
      };
    return { recordset: [], rowsAffected: [1] };
  });
}
function configuration(profile: ValidationSettings = validationProfile(), filter = '') {
  return channelSchema.parse({
    name: 'Synthetic validated integration',
    source: { type: 'HTTP', inboundDataType: 'JSON' },
    processingScript: mapping,
    filterScript: filter,
    validationProfile: profile,
    destinations: [
      {
        id: 2,
        name: destination.name,
        type: destination.type,
        endpoint: destination.endpoint,
        outboundDataType: destination.outbound_data_type,
        retryEnabled: true,
        maxRetries: 3,
        timeoutMs: 1000,
      },
    ],
  });
}
function expectNoOutbound() {
  expect(state.send).not.toHaveBeenCalled();
  expect(
    state.writes.some(
      (write) => write.sql.includes('INSERT INTO "Messages"') && write.sql.includes("'OUT'"),
    ),
  ).toBe(false);
  expect(
    state.writes.some((write) =>
      /INSERT INTO "(?:DeliverySlots|MessageDestinationLog)"/.test(write.sql),
    ),
  ).toBe(false);
  expect(state.writes.some((write) => write.inputs.status === 'RETRYING')).toBe(false);
}
beforeEach(() => {
  state.writes = [];
  state.lastError = '';
  state.inboundPayload = '';
  state.inboundStatus = '';
  state.send.mockImplementation(async (_url, _body, _headers, _timeout, received) => {
    received?.(200);
    return 'Synthetic HTTP 200';
  });
  database();
});

describe('Field validation in the real inbound pipeline (database and network isolated)', () => {
  it('validates the inbound JSON before mapping and delivers the actual XML with revision and correlation preserved', async () => {
    const input = payload();
    const original = structuredClone(input);
    const result = await processInboundMessage(1, input, 'synthetic-validation-correlation');
    expect(result).toMatchObject({ inboundStatus: 'SUCCESS', inboundMessageId: 4 });
    expect(state.send).toHaveBeenCalledOnce();
    expect(state.send.mock.calls[0][1]).toContain('<PatientID>SYNTHETIC-PRIVATE-ID</PatientID>');
    expect(state.send.mock.calls[0][1]).toContain('<BirthDate>2000-02-29</BirthDate>');
    expect(state.send.mock.calls[0][2]).toMatchObject({
      'Content-Type': 'application/xml',
      'x-correlation-id': 'synthetic-validation-correlation',
    });
    const reservations = state.writes.filter((write) =>
      write.sql.includes('INSERT INTO "Messages"'),
    );
    expect(reservations).toHaveLength(2);
    for (const reservation of reservations)
      expect(reservation.inputs).toMatchObject({
        revision: 7,
        correlation: 'synthetic-validation-correlation',
      });
    expect(input).toEqual(original);
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty text', ''],
    ['whitespace', ' \t\n '],
  ])(
    'records IN-ERROR for a %s required field without reserving delivery or retrying',
    async (_label, invalid) => {
      const input: Record<string, unknown> = payload();
      if (invalid === undefined) delete input.patient_id;
      else input.patient_id = invalid;
      await expect(processInboundMessage(1, input)).rejects.toMatchObject({
        status: 422,
        code: 'FIELD_VALIDATION_FAILED',
        results: expect.arrayContaining([
          expect.objectContaining({ field: 'patient_id', status: 'FAILED', code: 'REQUIRED' }),
        ]),
      });
      expect(state.inboundStatus).toBe('IN-ERROR');
      expect(state.writes.some((write) => write.sql.includes('SET transformed_payload='))).toBe(
        false,
      );
      expect(state.lastError).not.toContain('Synthetic Private Patient');
      expect(state.lastError).not.toContain('2000-02-29');
      expectNoOutbound();
    },
  );

  it('keeps validation errors distinct from a valid message excluded by the source filter', async () => {
    const filter = compileSimpleCondition({
      version: 1,
      field: 'gender',
      operator: 'eq',
      value: 'M',
    });
    database(validationProfile(), filter);
    const valid = await processInboundMessage(1, payload());
    expect(valid).toMatchObject({ success: true, inboundStatus: 'FILTERED', outboundResults: [] });
    expect(state.inboundStatus).toBe('FILTERED');
    expectNoOutbound();
    state.writes = [];
    const invalid = { ...payload(), gender: 'SYNTHETIC-INVALID-GENDER' };
    await expect(processInboundMessage(1, invalid)).rejects.toMatchObject({
      code: 'FIELD_VALIDATION_FAILED',
    });
    expect(state.inboundStatus).toBe('IN-ERROR');
    expectNoOutbound();
  });

  it.each([
    ['gender', 'SYNTHETIC-PRIVATE-UNSUPPORTED', 'ALLOWED_VALUES'],
    ['date_of_birth', '2001-02-29', 'DATE'],
    ['date_of_birth', '2000-13-01', 'DATE'],
    ['date_of_birth', '2000-02-29T12:00:00Z', 'DATE'],
    ['patient_id', 123, 'TYPE'],
  ])(
    'rejects invalid %s with a safe %s diagnostic before transformation or delivery',
    async (field, invalid, code) => {
      const input = { ...payload(), [field]: invalid };
      const original = structuredClone(input);
      await expect(processInboundMessage(1, input)).rejects.toMatchObject({
        code: 'FIELD_VALIDATION_FAILED',
        results: expect.arrayContaining([
          expect.objectContaining({ field, status: 'FAILED', code }),
        ]),
      });
      expect(input).toEqual(original);
      expect(state.writes.some((write) => write.sql.includes('SET transformed_payload='))).toBe(
        false,
      );
      expectNoOutbound();
    },
  );

  it('accepts zero and false, skips only absent optional fields, and never coerces or inserts values', async () => {
    const profile: ValidationSettings = {
      ...validationProfile(),
      fieldRules: [
        { field: 'count', type: 'number', required: true, minimum: 0, maximum: 10 },
        { field: 'active', type: 'boolean', required: true },
        { field: 'note', type: 'text', required: false },
      ],
    };
    const input = { count: 0, active: false };
    expect(await validatePayload(input, 'JSON', profile)).toEqual([
      expect.objectContaining({ field: 'count', status: 'PASSED' }),
      expect.objectContaining({ field: 'active', status: 'PASSED' }),
      expect.objectContaining({ field: 'note', status: 'SKIPPED' }),
    ]);
    expect(input).toEqual({ count: 0, active: false });
    for (const invalid of [
      { count: '0', active: false },
      { count: 0, active: 'false' },
      { count: 0, active: false, note: null },
    ])
      await expect(validatePayload(invalid, 'JSON', profile)).rejects.toMatchObject({
        code: 'FIELD_VALIDATION_FAILED',
      });
  });

  it('uses the same rule decisions in dry-run and runtime without DNS, writes, probes or delivery during preview', async () => {
    for (const input of [
      payload(),
      { ...payload(), patient_id: '' },
      { ...payload(), gender: 'INVALID', date_of_birth: '2026-02-30' },
    ]) {
      let runtimeResults: ValidationRuleResult[];
      try {
        runtimeResults = await validatePayload(input, 'JSON', validationProfile());
        await processInboundMessage(1, input);
      } catch (error) {
        runtimeResults = (error as { results: ValidationRuleResult[] }).results;
        await expect(processInboundMessage(1, input)).rejects.toMatchObject({
          code: 'FIELD_VALIDATION_FAILED',
        });
      }
      const writes = state.writes.length;
      const sends = state.send.mock.calls.length;
      const preview = await runConfiguration(configuration(), input);
      const decisions = (results: ValidationRuleResult[]) =>
        results.map(({ field, type, required, status, code }) => ({
          field,
          type,
          required,
          status,
          code,
        }));
      expect(decisions(preview.source.validationResults)).toEqual(decisions(runtimeResults));
      expect(preview.source.validation).toBe(
        input.patient_id && input.gender !== 'INVALID' ? 'PASSED' : 'ERROR',
      );
      expect(preview.networkDelivery).toBe('NOT_SENT');
      expect(state.writes).toHaveLength(writes);
      expect(state.send).toHaveBeenCalledTimes(sends);
      expect(state.lookup).not.toHaveBeenCalled();
      expect(state.probe).not.toHaveBeenCalled();
      if (!preview.success) {
        expect(preview.source).toMatchObject({
          filter: 'SKIPPED',
          transformation: 'SKIPPED',
          code: 'FIELD_VALIDATION_FAILED',
        });
        expect(preview.results).toEqual([]);
      }
    }
  });

  it('preserves disabled rules without evaluating them or executing retained custom code', async () => {
    const profile: ValidationSettings = {
      ...validationProfile(),
      mode: 'NONE',
      custom: { script: 'throw new Error("SYNTHETIC-PRIVATE-CUSTOM");' },
    };
    database(profile, '', 'return msg;');
    const input = { name: 'Synthetic Private Patient' };
    expect((await processInboundMessage(1, input)).inboundStatus).toBe('SUCCESS');
    expect(state.send).toHaveBeenCalledOnce();
    expect(configuration(profile).validationProfile).toEqual(profile);
    expect(profile.fieldRules).toEqual(fieldRules);
  });

  it.each([
    [
      'JSON Schema',
      {
        jsonSchema: {
          type: 'object',
          properties: { patient_id: { type: 'string', minLength: 1 } },
          required: ['patient_id'],
        },
      },
      'PAYLOAD_SCHEMA_REJECTED',
    ],
    [
      'sandbox script',
      { script: 'return typeof msg.patient_id === "string" && msg.patient_id.trim().length > 0;' },
      'PAYLOAD_VALIDATION_REJECTED',
    ],
  ])(
    'runs the displayed custom %s approach against each inbound message',
    async (_label, custom, code) => {
      const profile: ValidationSettings = { version: 1, mode: 'CUSTOM', fieldRules: [], custom };
      database(profile);
      const input = payload();
      expect((await processInboundMessage(1, input)).inboundStatus).toBe('SUCCESS');
      expect(input).toEqual(payload());
      expect(state.send).toHaveBeenCalledOnce();
      state.send.mockClear();
      state.writes = [];
      await expect(
        processInboundMessage(1, { ...payload(), patient_id: '' }),
      ).rejects.toMatchObject({ code });
      expect(state.inboundStatus).toBe('IN-ERROR');
      expect(state.lastError).toBe(code);
      expectNoOutbound();
    },
  );

  it('returns a correlated MLLP AE when custom channel validation rejects valid HL7 syntax', async () => {
    database(
      { version: 1, mode: 'CUSTOM', fieldRules: [], custom: { script: 'return false;' } },
      '',
      '',
      'HL7',
    );
    const previous = {
      port: config.hl7.port,
      host: config.hl7.host,
      allowedIps: config.hl7.allowedIps,
    };
    config.hl7.port = 0;
    config.hl7.host = '127.0.0.1';
    config.hl7.allowedIps = ['127.0.0.1'];
    let server: net.Server | undefined;
    let client: net.Socket | undefined;
    try {
      server = await startHl7Listener();
      const ack = await new Promise<string>((resolve, reject) => {
        const decoder = new MllpDecoder();
        client = net.createConnection((server!.address() as net.AddressInfo).port, '127.0.0.1');
        client.setTimeout(2000, () => reject(new Error('Synthetic MLLP response timeout')));
        client.on('error', reject);
        client.on('connect', () => client!.write(frame(sample)));
        client.on('data', (chunk) => {
          const messages = decoder.push(chunk);
          if (messages.length) {
            client!.end();
            resolve(messages[0]);
          }
        });
      });
      expect(ack).toContain('MSA|AE|ID123');
      expect(ack).toContain('PAYLOAD_VALIDATION_REJECTED');
      expect(state.inboundStatus).toBe('IN-ERROR');
      expectNoOutbound();
    } finally {
      client?.destroy();
      if (server) await stopHl7Listener(server);
      Object.assign(config.hl7, previous);
    }
  });
});

describe('Authenticated HTTP source validation and safe diagnostic presentation', () => {
  it('accepts a valid HTTP request with its per-channel source key and completes XML delivery', async () => {
    const response = await request(app)
      .post('/api/inbound/1')
      .set('X-API-Key', apiKey)
      .send(payload());
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, messageId: 4, status: 'SUCCESS' });
    expect(state.send).toHaveBeenCalledOnce();
    expect(state.send.mock.calls[0][1]).toContain('<PatientID>SYNTHETIC-PRIVATE-ID</PatientID>');
    expect(state.send.mock.calls[0][2]).toMatchObject({
      'x-correlation-id': response.headers['x-request-id'],
    });
  });
  it.each([undefined, 'synthetic-wrong-key'])(
    'checks the source API key before parsing or processing (%s)',
    async (key) => {
      const call = request(app).post('/api/inbound/1').set('Content-Type', 'application/json');
      if (key) call.set('X-API-Key', key);
      const response = await call.send('{invalid JSON with synthetic-private-value');
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('CONNECTOR_UNAUTHORIZED');
      expect(state.writes.some((write) => write.sql.includes('INSERT INTO "Messages"'))).toBe(
        false,
      );
      expectNoOutbound();
    },
  );

  it('returns 422 with safe failed fields and stores no payload in validation diagnostics or structured logs', async () => {
    const stream = (logger as unknown as Record<symbol, { write: (line: string) => void }>)[
      pino.symbols.streamSym
    ];
    const write = vi.spyOn(stream, 'write').mockImplementation(() => {});
    const previousLevel = logger.level;
    logger.level = 'info';
    try {
      const input = { ...payload(), patient_id: '', gender: 'SYNTHETIC-PRIVATE-INVALID' };
      const response = await request(app)
        .post('/api/inbound/1')
        .set('X-API-Key', apiKey)
        .send(input);
      expect(response.status).toBe(422);
      expect(response.body).toMatchObject({
        success: false,
        code: 'FIELD_VALIDATION_FAILED',
        requestId: response.headers['x-request-id'],
        details: [
          expect.objectContaining({ field: 'patient_id', status: 'FAILED', code: 'REQUIRED' }),
          expect.objectContaining({ field: 'gender', status: 'FAILED', code: 'ALLOWED_VALUES' }),
        ],
      });
      expect(state.inboundStatus).toBe('IN-ERROR');
      const diagnostics = JSON.stringify({
        body: response.body,
        persisted: state.lastError,
        logs: write.mock.calls,
      });
      for (const secret of [apiKey, input.name, input.gender, input.date_of_birth])
        expect(diagnostics).not.toContain(secret);
      expect(diagnostics).not.toContain('SELECT ');
      expect(diagnostics).not.toContain('server/src');
      expectNoOutbound();
    } finally {
      logger.level = previousLevel;
      write.mockRestore();
    }
  });

  it('rejects malformed JSON separately before accepting a message', async () => {
    const response = await request(app)
      .post('/api/inbound/1')
      .set('X-API-Key', apiKey)
      .set('Content-Type', 'application/json')
      .send('{"patient_id":"SYNTHETIC-PRIVATE-PARSE",');
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_JSON');
    expect(JSON.stringify(response.body)).not.toContain('SYNTHETIC-PRIVATE-PARSE');
    expect(state.writes.some((write) => write.sql.includes('INSERT INTO "Messages"'))).toBe(false);
    expectNoOutbound();
  });

  it('presents retained validation failure fields in message detail while redacting the patient payload', async () => {
    await expect(
      processInboundMessage(1, { ...payload(), gender: 'SYNTHETIC-PRIVATE-INVALID' }),
    ).rejects.toMatchObject({ code: 'FIELD_VALIDATION_FAILED' });
    const token = signToken({ id: 1, name: 'Synthetic administrator', role: 'ADMIN' });
    const detail = await request(app)
      .get('/api/message/4')
      .set('Authorization', 'Bearer ' + token);
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({
      status: 'IN-ERROR',
      errorCode: 'FIELD_VALIDATION_FAILED',
      validation: {
        code: 'FIELD_VALIDATION_FAILED',
        results: [
          expect.objectContaining({ field: 'gender', code: 'ALLOWED_VALUES', status: 'FAILED' }),
        ],
      },
    });
    expect(detail.body.data.errorCode).not.toContain('VALIDATION_DETAILS_V1');
    expect(JSON.stringify(detail.body.data.validation)).not.toContain('SYNTHETIC-PRIVATE');
    expect(JSON.stringify(detail.body.data.originalPayload)).not.toContain(
      'Synthetic Private Patient',
    );
    expectNoOutbound();
  });
});
