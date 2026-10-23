import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type net from 'node:net';
import type { Destination } from '../src/models/Destination.js';
import type { InboundStatus, OutboundStatus, StoredMessage } from '../src/models/Message.js';

type Connector = Destination & { is_enabled: boolean; is_deleted: boolean };
type MessageRow = Omit<
  StoredMessage,
  'transport_config' | 'destination_id' | 'inbound_message_id' | 'status'
> & {
  destination_id: number | null;
  inbound_message_id: number | null;
  status: InboundStatus | OutboundStatus;
  transport_config: string | null;
  last_error: string | null;
  next_retry_at: Date | null;
  channel_revision?: number;
};
const state = vi.hoisted(() => ({
  query: vi.fn(),
  writes: [] as { sql: string; inputs: Record<string, unknown> }[],
  messages: new Map<number, MessageRow>(),
  attempts: [] as Record<string, unknown>[],
  destinations: [] as Connector[],
  nextId: 10,
  open: new Set<number>(),
  full: false,
  sourceFilter: '',
  sourceTransformer: '',
  inboundType: 'JSON' as 'JSON' | 'XML',
  validation: {} as Record<string, unknown>,
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

import {
  processInboundMessage,
  processRetry,
  resendMessage,
} from '../src/services/messageProcessor.services.js';
import { runConfiguration } from '../src/services/dryRun.services.js';
import { compileSimpleCondition } from '../src/utils/simpleCondition.js';
import { compileFieldMapping } from '../src/utils/fieldMapping.js';
import { readDestinationFilter, writeDestinationFilter } from '../src/utils/sourceFilter.js';
import { channelSchema } from '../src/utils/validator.js';
import { decrypt, encrypt } from '../src/utils/secrets.js';
import { config } from '../src/config/env.js';

interface Received {
  body: string;
  headers: http.IncomingHttpHeaders;
  path?: string;
}
const servers: http.Server[] = [];
const sockets = new Set<net.Socket>();
async function receiver(options: { statuses?: number[]; silent?: boolean } = {}) {
  const received: Received[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      received.push({
        body: Buffer.concat(chunks).toString('utf8'),
        headers: req.headers,
        path: req.url,
      });
      if (options.silent) return;
      res.writeHead(options.statuses?.shift() ?? 200, { 'Content-Type': 'application/json' });
      res.end('{"synthetic":true}');
    });
  });
  servers.push(server);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  return {
    endpoint: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/synthetic`,
    received,
  };
}
const laboratoryFilter = compileSimpleCondition({
  version: 1,
  field: 'department',
  operator: 'eq',
  value: 'LAB',
});
function destination(endpoint: string, patch: Partial<Connector> = {}): Connector {
  return {
    id: 2,
    channel_id: 1,
    name: 'Synthetic receiver',
    type: 'REST',
    endpoint,
    outbound_data_type: 'JSON',
    processing_script: '',
    filter_script: '',
    template_script: '',
    response_script: '',
    is_enabled: true,
    is_deleted: false,
    retry_enabled: true,
    max_retries: 2,
    retry_interval_seconds: 1,
    timeout_ms: 1000,
    ...patch,
  };
}
const input = () => ({
  patient_id: 'SYNTHETIC-001',
  name: 'Synthetic Patient',
  department: 'LAB',
  status: 'ACTIVE',
});
const outboundRows = () => [...state.messages.values()].filter((row) => row.destination_id != null);
const noNetworkAttempt = (destinationId: number) => {
  expect(state.attempts.filter((attempt) => attempt.dest === destinationId)).toEqual([]);
  expect(
    state.writes.filter(
      (write) =>
        write.sql.includes('INSERT INTO "DeliverySlots"') && write.inputs.dest === destinationId,
    ),
  ).toEqual([]);
  for (const row of outboundRows().filter((row) => row.destination_id === destinationId)) {
    expect(row.retry_count).toBe(0);
    expect(row.next_retry_at).toBeNull();
    expect(row.transport_config).toBeNull();
  }
};
function draftConfiguration() {
  return channelSchema.parse({
    name: 'Synthetic destination integration',
    source: { type: 'HTTP', inboundDataType: state.inboundType },
    processingScript: state.sourceTransformer,
    filterScript: state.sourceFilter,
    validationProfile: state.validation,
    destinations: state.destinations.map((dest) => ({
      id: dest.id,
      name: dest.name,
      type: dest.type,
      endpoint: dest.endpoint,
      outboundDataType: dest.outbound_data_type,
      isEnabled: dest.is_enabled,
      processingScript: dest.processing_script,
      filterScript: dest.filter_script,
      templateScript: dest.template_script,
      responseScript: dest.response_script,
      retryEnabled: dest.retry_enabled,
      maxRetries: dest.max_retries,
      retryIntervalSeconds: dest.retry_interval_seconds,
      timeoutMs: dest.timeout_ms,
    })),
  });
}
beforeEach(() => {
  state.writes = [];
  state.messages = new Map();
  state.attempts = [];
  state.destinations = [];
  state.nextId = 10;
  state.open = new Set();
  state.full = false;
  state.sourceFilter = '';
  state.sourceTransformer = '';
  state.inboundType = 'JSON';
  state.validation = {};
  state.query.mockImplementation(async (sql: string, inputs: Record<string, unknown>) => {
    if (sql.includes('SELECT * FROM "Channels"'))
      return {
        recordset: [
          {
            id: 1,
            status: 'RUNNING',
            source_type: 'HTTP',
            active_revision: 3,
            inbound_data_type: state.inboundType,
            filter_script: state.sourceFilter,
            processing_script: state.sourceTransformer,
            validation_profile: JSON.stringify(state.validation),
          },
        ],
        rowsAffected: [1],
      };
    if (sql.includes('SELECT * FROM "Destinations"'))
      return {
        recordset: state.destinations.filter(
          (dest) => !dest.is_deleted && (!sql.includes('is_enabled=true') || dest.is_enabled),
        ),
        rowsAffected: [1],
      };
    if (sql.includes('INSERT INTO "Messages"')) {
      const inbound = sql.includes("'IN'");
      const row: MessageRow = {
        id: state.nextId++,
        channel_id: Number(inputs.channel),
        destination_id: inbound ? null : Number(inputs.dest),
        inbound_message_id: inbound ? null : Number(inputs.parent),
        original_payload: String(inputs.payload),
        transformed_payload: String(inputs.payload),
        status: inbound ? 'IN-PROCESS' : 'PROCESSING',
        retry_count: 0,
        correlation_id: String(inputs.correlation),
        transport_config: sql.includes('@snapshot') ? String(inputs.snapshot) : null,
        last_error: null,
        next_retry_at: null,
        channel_revision: Number(inputs.revision),
      };
      state.messages.set(row.id, row);
      return { recordset: [row], rowsAffected: [1] };
    }
    if (sql.includes('SELECT status FROM "Messages"'))
      return {
        recordset: outboundRows()
          .filter((row) => row.inbound_message_id === inputs.id)
          .map(({ status }) => ({ status })),
        rowsAffected: [1],
      };
    if (sql.includes('SELECT * FROM "Messages"') && sql.includes('FOR UPDATE')) {
      const row = state.messages.get(Number(inputs.id));
      const enabled = state.destinations.some(
        (dest) => dest.id === row?.destination_id && dest.is_enabled && !dest.is_deleted,
      );
      return {
        recordset:
          row &&
          row.transport_config &&
          enabled &&
          ['OUT-ERROR', 'DEAD_LETTER'].includes(row.status)
            ? [row]
            : [],
        rowsAffected: [1],
      };
    }
    if (sql.includes('SELECT EXISTS(SELECT 1 FROM "MessageDestinationLog"'))
      return {
        recordset: [
          {
            prepared: state.attempts.some(
              (attempt) =>
                attempt.id === inputs.id &&
                (attempt.requestDurationMs != null ||
                  attempt.httpStatus != null ||
                  attempt.ack != null ||
                  [
                    'DESTINATION_CIRCUIT_OPEN',
                    'DELIVERY_CAPACITY',
                    'DELIVERY_ALREADY_ACTIVE',
                  ].includes(String(attempt.response))),
            ),
          },
        ],
        rowsAffected: [1],
      };
    if (sql.includes('SELECT *,open_until'))
      return { recordset: [{ is_open: state.open.has(Number(inputs.dest)) }], rowsAffected: [1] };
    if (sql.includes('SELECT count(*) total,count(*) FILTER'))
      return {
        recordset: [{ total: state.full ? config.delivery.maxActive : 0, destination: 0 }],
        rowsAffected: [1],
      };
    if (sql.startsWith('UPDATE "Messages"')) {
      const row = state.messages.get(Number(inputs.id));
      if (sql.includes("status='RETRYING'") && sql.includes('RETURNING *')) {
        if (!row || !row.transport_config || !['OUT-ERROR', 'DEAD_LETTER'].includes(row.status))
          return { recordset: [], rowsAffected: [0] };
      }
      if (row) {
        if (sql.includes('transformed_payload=@payload'))
          row.transformed_payload = String(inputs.payload);
        if (sql.includes('transport_config=@snapshot'))
          row.transport_config = String(inputs.snapshot);
        else if (sql.includes('transport_config=NULL')) row.transport_config = null;
        if (sql.includes('status=@status')) row.status = inputs.status as MessageRow['status'];
        else if (sql.includes("status='IN-ERROR'")) row.status = 'IN-ERROR';
        else if (sql.includes("status='FILTERED'")) row.status = 'FILTERED';
        else if (sql.includes("status='RETRYING'")) row.status = 'RETRYING';
        if ('error' in inputs) row.last_error = inputs.error as string | null;
        if ('count' in inputs) row.retry_count = Number(inputs.count);
        if ('delay' in inputs)
          row.next_retry_at =
            inputs.delay == null ? null : new Date(Date.now() + Number(inputs.delay) * 1000);
      }
      return { recordset: row ? [row] : [], rowsAffected: [row ? 1 : 0] };
    }
    if (sql.includes('INSERT INTO "MessageDestinationLog"')) state.attempts.push({ ...inputs });
    return { recordset: [], rowsAffected: [1] };
  });
});
afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe('Destination pipeline with actual loopback HTTP receivers (database isolated)', () => {
  it('bypasses a disabled filter while retaining its exact condition and delivering the actual message', async () => {
    const local = await receiver();
    const retained = writeDestinationFilter(laboratoryFilter, false);
    state.destinations = [destination(local.endpoint, { filter_script: retained })];
    const payload = { ...input(), department: 'RAD' };
    expect((await processInboundMessage(1, payload)).inboundStatus).toBe('SUCCESS');
    expect(local.received).toHaveLength(1);
    expect(JSON.parse(local.received[0].body)).toEqual(payload);
    expect(readDestinationFilter(draftConfiguration().destinations[0].filterScript)).toEqual({
      enabled: false,
      rule: laboratoryFilter,
    });
    expect(writeDestinationFilter(readDestinationFilter(retained).rule, true)).toBe(
      laboratoryFilter,
    );
  });

  it('does not execute a retained legacy script when its filter is disabled', async () => {
    const local = await receiver();
    const legacy = 'throw new Error("SYNTHETIC-INACTIVE-LEGACY-FILTER");';
    state.destinations = [
      destination(local.endpoint, { filter_script: writeDestinationFilter(legacy, false) }),
    ];
    expect((await processInboundMessage(1, input())).inboundStatus).toBe('SUCCESS');
    expect(local.received).toHaveLength(1);
    expect(readDestinationFilter(draftConfiguration().destinations[0].filterScript)).toEqual({
      enabled: false,
      rule: legacy,
    });
  });

  it('delivers matching messages and skips only mismatches without network attempts or retry', async () => {
    const local = await receiver();
    state.destinations = [destination(local.endpoint, { filter_script: laboratoryFilter })];
    expect((await processInboundMessage(1, input())).inboundStatus).toBe('SUCCESS');
    expect(local.received).toHaveLength(1);
    state.attempts = [];
    state.writes = [];
    const filtered = await processInboundMessage(1, { ...input(), department: 'RAD' });
    expect(filtered).toMatchObject({
      success: true,
      inboundStatus: 'FILTERED',
      outboundResults: [{ destinationId: 2, status: 'FILTERED' }],
    });
    expect(local.received).toHaveLength(1);
    expect(outboundRows().at(-1)?.status).toBe('FILTERED');
    // Earlier successful rows are prepared; inspect this message only.
    const lastRow = outboundRows().at(-1)!;
    expect(lastRow.transport_config).toBeNull();
    expect(lastRow.next_retry_at).toBeNull();
    expect(lastRow.retry_count).toBe(0);
    expect(state.attempts).toEqual([]);
    expect(state.writes.some((write) => write.sql.includes('INSERT INTO "DeliverySlots"'))).toBe(
      false,
    );
  });

  it('never evaluates disabled destination filters or scripts and retains their settings', async () => {
    const local = await receiver();
    const disabled = destination(local.endpoint, {
      is_enabled: false,
      filter_script: 'throw new Error("SYNTHETIC-DISABLED-FILTER");',
      processing_script: 'throw new Error("SYNTHETIC-DISABLED-TRANSFORM");',
      template_script: 'throw new Error("SYNTHETIC-DISABLED-TEMPLATE");',
    });
    state.destinations = [disabled];
    const result = await processInboundMessage(1, input());
    expect(result.success).toBe(true);
    expect(result.outboundResults).toEqual([]);
    expect(local.received).toEqual([]);
    expect(outboundRows()).toEqual([]);
    noNetworkAttempt(disabled.id);
    const saved = draftConfiguration().destinations[0];
    expect(saved).toMatchObject({
      isEnabled: false,
      filterScript: disabled.filter_script,
      processingScript: disabled.processing_script,
      templateScript: disabled.template_script,
    });
    const writes = state.writes.length;
    const preview = await runConfiguration(draftConfiguration(), input());
    expect(preview.success).toBe(true);
    expect(preview.results[0]).toMatchObject({
      enabled: false,
      delivery: 'DISABLED',
      routed: false,
      stages: {
        filter: 'NOT_RUN',
        transformation: 'SKIPPED',
        template: 'SKIPPED',
        conversion: 'SKIPPED',
      },
    });
    expect(state.writes).toHaveLength(writes);
    expect(local.received).toEqual([]);
  });

  it('delivers to A and filters B independently, without treating the source channel as failed', async () => {
    const a = await receiver();
    const b = await receiver();
    state.destinations = [
      destination(a.endpoint),
      destination(b.endpoint, {
        id: 3,
        name: 'Synthetic laboratory',
        filter_script: laboratoryFilter,
      }),
    ];
    const result = await processInboundMessage(1, { ...input(), department: 'RAD' });
    expect(result).toMatchObject({ success: true, inboundStatus: 'SUCCESS' });
    expect(a.received).toHaveLength(1);
    expect(b.received).toEqual([]);
    expect(outboundRows().map((row) => row.status)).toEqual(['OUT-SENT', 'FILTERED']);
    noNetworkAttempt(3);
    expect(state.attempts).toHaveLength(1);
  });

  it('runs validation before source filtering and stops both destinations when the source filter rejects', async () => {
    const a = await receiver();
    const b = await receiver();
    state.destinations = [destination(a.endpoint), destination(b.endpoint, { id: 3 })];
    state.validation = {
      version: 1,
      mode: 'FIELDS',
      fieldRules: [{ field: 'patient_id', type: 'text', required: true }],
      custom: {},
    };
    state.sourceFilter = compileSimpleCondition({
      version: 1,
      field: 'status',
      operator: 'eq',
      value: 'ACTIVE',
    });
    await expect(
      processInboundMessage(1, { ...input(), patient_id: '', status: 'INACTIVE' }),
    ).rejects.toMatchObject({ code: 'FIELD_VALIDATION_FAILED' });
    expect((await processInboundMessage(1, { ...input(), status: 'INACTIVE' })).inboundStatus).toBe(
      'FILTERED',
    );
    expect(a.received).toEqual([]);
    expect(b.received).toEqual([]);
    expect(outboundRows()).toEqual([]);
    expect(state.attempts).toEqual([]);
  });

  it('filters the source-processed message before each destination transformer and matches dry-run to actual XML bytes and Content-Type', async () => {
    const local = await receiver();
    state.validation = {
      version: 1,
      mode: 'FIELDS',
      fieldRules: [{ field: 'patient_id', type: 'text', required: true }],
      custom: {},
    };
    state.sourceFilter = compileSimpleCondition({
      version: 1,
      field: 'status',
      operator: 'eq',
      value: 'ACTIVE',
    });
    state.sourceTransformer =
      'return { patient: { id: msg.patient_id, name: msg.name }, routing: { department: msg.department } };';
    const transformer = compileFieldMapping({
      version: 1,
      rootElement: 'Patient',
      rows: [
        { source: 'patient.id', target: 'PatientID', required: true },
        { source: 'patient.name', target: 'PatientName', required: true },
      ],
    });
    state.destinations = [
      destination(local.endpoint, {
        outbound_data_type: 'XML',
        processing_script: transformer,
        filter_script: compileSimpleCondition({
          version: 1,
          field: 'routing.department',
          operator: 'eq',
          value: 'LAB',
        }),
      }),
    ];
    const payload = input();
    const preview = await runConfiguration(draftConfiguration(), payload);
    expect(preview.success).toBe(true);
    expect(preview.networkDelivery).toBe('NOT_SENT');
    expect(local.received).toEqual([]);
    expect(state.writes).toEqual([]);
    const result = await processInboundMessage(1, payload, 'synthetic-end-to-end-correlation');
    expect(result.inboundStatus).toBe('SUCCESS');
    expect(local.received).toHaveLength(1);
    expect(local.received[0].body).toBe(preview.results[0].finalPayload);
    expect(local.received[0].body).toContain('<PatientID>SYNTHETIC-001</PatientID>');
    expect(local.received[0].body).not.toContain('patient_id');
    expect(local.received[0].headers['content-type']).toMatch(/^application\/xml(?:;|$)/);
    expect(local.received[0].headers['x-correlation-id']).toBe('synthetic-end-to-end-correlation');
    expect(payload).toEqual(input());
    expect(state.attempts[0]).toMatchObject({ dest: 2, httpStatus: 200, status: 'OUT-SENT' });
    expect(state.attempts[0].requestDurationMs).toEqual(expect.any(Number));
    const row = outboundRows()[0];
    expect(JSON.parse(row.transformed_payload)).toBe(local.received[0].body);
    expect(JSON.parse(decrypt(row.transport_config!))).toMatchObject({
      id: 2,
      endpoint: local.endpoint,
    });
    expect(row.channel_revision).toBe(3);
  });

  it('keeps different mappings and nested mutation isolated across destinations', async () => {
    const a = await receiver();
    const b = await receiver();
    state.sourceTransformer =
      'return { patient: { id: msg.patient_id, name: msg.name }, department: msg.department };';
    const mapped = compileFieldMapping({
      version: 1,
      rows: [
        { source: 'patient.id', target: 'patientCode', required: true },
        { source: 'patient.name', target: 'fullName', required: true },
      ],
    });
    state.destinations = [
      destination(a.endpoint, {
        processing_script: 'msg.patient.name = "SYNTHETIC-ONLY-A"; return { systemA: msg };',
      }),
      destination(b.endpoint, { id: 3, processing_script: mapped }),
    ];
    const payload = input();
    expect((await processInboundMessage(1, payload)).inboundStatus).toBe('SUCCESS');
    expect(JSON.parse(a.received[0].body)).toMatchObject({
      systemA: { patient: { name: 'SYNTHETIC-ONLY-A' } },
    });
    expect(JSON.parse(b.received[0].body)).toEqual({
      patientCode: 'SYNTHETIC-001',
      fullName: 'Synthetic Patient',
    });
    expect(b.received[0].body).not.toContain('SYNTHETIC-ONLY-A');
    expect(payload).toEqual(input());
  });

  it('converts XML input through the existing destination mapping and delivers JSON with the correct content type', async () => {
    const local = await receiver();
    state.inboundType = 'XML';
    state.destinations = [
      destination(local.endpoint, {
        processing_script: compileFieldMapping({
          version: 1,
          rows: [
            { source: 'Patient.ID', target: 'patientCode', required: true },
            { source: 'Patient.Name', target: 'fullName', required: true },
          ],
        }),
      }),
    ];
    const payload =
      '<Patient><ID>SYNTHETIC-XML-001</ID><Name>Synthetic XML Patient</Name></Patient>';
    const preview = await runConfiguration(draftConfiguration(), payload);
    expect(local.received).toEqual([]);
    expect((await processInboundMessage(1, payload)).inboundStatus).toBe('SUCCESS');
    expect(JSON.parse(local.received[0].body)).toEqual({
      patientCode: 'SYNTHETIC-XML-001',
      fullName: 'Synthetic XML Patient',
    });
    expect(JSON.parse(local.received[0].body)).toEqual(preview.results[0].finalPayload);
    expect(local.received[0].headers['content-type']).toMatch(/^application\/json(?:;|$)/);
  });

  it('preserves the legacy post-transform template and sends its final payload rather than the mapping output', async () => {
    const local = await receiver();
    const processing = compileFieldMapping({
      version: 1,
      rows: [{ source: 'patient_id', target: 'patientCode', required: true }],
    });
    const template =
      'return { envelope: { id: msg.patientCode, template: "SYNTHETIC-LEGACY-TEMPLATE" } };';
    state.destinations = [
      destination(local.endpoint, { processing_script: processing, template_script: template }),
    ];
    const configuration = draftConfiguration();
    expect(configuration.destinations[0]).toMatchObject({
      processingScript: processing,
      templateScript: template,
    });
    const preview = await runConfiguration(configuration, input());
    expect(local.received).toEqual([]);
    expect((await processInboundMessage(1, input())).inboundStatus).toBe('SUCCESS');
    expect(JSON.parse(local.received[0].body)).toEqual({
      envelope: { id: 'SYNTHETIC-001', template: 'SYNTHETIC-LEGACY-TEMPLATE' },
    });
    expect(JSON.parse(local.received[0].body)).toEqual(preview.results[0].finalPayload);
  });

  it.each(['return true;', 'true', 'return msg.department === "LAB";'])(
    'preserves an enabled legacy filter (%s)',
    async (filter) => {
      const local = await receiver();
      state.destinations = [destination(local.endpoint, { filter_script: filter })];
      expect(draftConfiguration().destinations[0].filterScript).toBe(filter);
      expect((await processInboundMessage(1, input())).inboundStatus).toBe('SUCCESS');
      expect(local.received).toHaveLength(1);
    },
  );

  it.each(['return false;', 'false'])(
    'keeps legacy Skip configuration from sending unintentionally (%s)',
    async (filter) => {
      const local = await receiver();
      state.destinations = [destination(local.endpoint, { filter_script: filter })];
      expect(draftConfiguration().destinations[0].filterScript).toBe(filter);
      expect((await processInboundMessage(1, input())).inboundStatus).toBe('FILTERED');
      expect(local.received).toEqual([]);
      noNetworkAttempt(2);
    },
  );

  it.each([
    [
      'filter',
      { filter_script: 'throw new Error("SYNTHETIC-PRIVATE-FILTER");' },
      'DESTINATION_FILTER_ERROR:',
    ],
    [
      'transformer',
      {
        processing_script: compileFieldMapping({
          version: 1,
          rows: [{ source: 'missing', target: 'PatientID', required: true }],
        }),
      },
      'DESTINATION_TRANSFORM_ERROR:',
    ],
    [
      'template',
      { template_script: 'throw new Error("SYNTHETIC-PRIVATE-TEMPLATE");' },
      'DESTINATION_TEMPLATE_ERROR:',
    ],
    ['conversion', { outbound_data_type: 'HL7V2' }, 'DESTINATION_CONVERSION_ERROR:'],
  ] as const)(
    'isolates a destination %s failure and prevents unsafe manual resend or retry',
    async (_stage, patch, prefix) => {
      const bad = await receiver();
      const good = await receiver();
      state.destinations = [
        destination(bad.endpoint, patch),
        destination(good.endpoint, { id: 3 }),
      ];
      const result = await processInboundMessage(1, input());
      expect(result.inboundStatus).toBe('PARTIAL');
      expect(bad.received).toEqual([]);
      expect(good.received).toHaveLength(1);
      const failed = outboundRows().find((row) => row.destination_id === 2)!;
      expect(failed.status).toBe('OUT-ERROR');
      expect(failed.last_error).toMatch(new RegExp(`^${prefix}`));
      expect(failed.last_error).not.toContain('SYNTHETIC-PRIVATE');
      noNetworkAttempt(2);
      await expect(resendMessage(failed.id)).rejects.toMatchObject({ code: 'RESEND_UNAVAILABLE' });
      expect(bad.received).toEqual([]);
    },
  );

  it('rejects corrupted canonical filter metadata on save and fails closed at runtime', async () => {
    const local = await receiver();
    const corrupt = laboratoryFilter + '\nreturn true;';
    state.destinations = [destination(local.endpoint, { filter_script: corrupt })];
    expect(() => draftConfiguration()).toThrow();
    const result = await processInboundMessage(1, input());
    expect(result.inboundStatus).toBe('FAILED');
    expect(outboundRows()[0].last_error).toBe('DESTINATION_FILTER_ERROR:FILTER_CONFIG_INVALID');
    expect(local.received).toEqual([]);
    noNetworkAttempt(2);
  });

  it.each(['return "false";', 'return {};'])(
    'rejects a non-boolean legacy filter result (%s) before delivery',
    async (filter) => {
      const local = await receiver();
      state.destinations = [destination(local.endpoint, { filter_script: filter })];
      expect((await processInboundMessage(1, input())).inboundStatus).toBe('FAILED');
      expect(outboundRows()[0].last_error).toBe('DESTINATION_FILTER_ERROR:FILTER_RESULT_INVALID');
      expect(local.received).toEqual([]);
      noNetworkAttempt(2);
    },
  );

  it.each([
    '<Patient>',
    '<!DOCTYPE Patient [<!ENTITY phi "SYNTHETIC-PRIVATE">]><Patient>&phi;</Patient>',
  ])('rejects malformed or entity-bearing XML output before HTTP delivery', async (xml) => {
    const local = await receiver();
    state.destinations = [
      destination(local.endpoint, {
        outbound_data_type: 'XML',
        processing_script: `return ${JSON.stringify(xml)};`,
      }),
    ];
    const preview = await runConfiguration(draftConfiguration(), input());
    expect(preview.success).toBe(false);
    expect(preview.results[0].stages.conversion).toBe('ERROR');
    expect(local.received).toEqual([]);
    expect((await processInboundMessage(1, input())).inboundStatus).toBe('FAILED');
    expect(outboundRows()[0].last_error).toMatch(/^DESTINATION_CONVERSION_ERROR:/);
    expect(local.received).toEqual([]);
    noNetworkAttempt(2);
  });

  it('retries HTTP 500 with the saved final XML and connector snapshot without applying mappings or templates twice', async () => {
    const local = await receiver({ statuses: [500, 200] });
    const mapped = compileFieldMapping({
      version: 1,
      rootElement: 'Patient',
      rows: [{ source: 'patient_id', target: 'PatientID', required: true }],
    });
    state.destinations = [
      destination(local.endpoint, { processing_script: mapped, outbound_data_type: 'XML' }),
    ];
    expect((await processInboundMessage(1, input())).inboundStatus).toBe('QUEUED');
    const queued = outboundRows()[0];
    expect(queued.status).toBe('QUEUED');
    expect(queued.next_retry_at).toBeInstanceOf(Date);
    expect(state.attempts[0].httpStatus).toBe(500);
    // Change the live configuration. A retry must continue using the immutable prepared body.
    state.destinations[0].processing_script = 'throw new Error("SYNTHETIC-CHANGED-TRANSFORM");';
    state.destinations[0].template_script = 'throw new Error("SYNTHETIC-CHANGED-TEMPLATE");';
    state.destinations[0].endpoint = 'http://169.254.169.254/never';
    queued.status = 'RETRYING';
    queued.lease_owner = 'synthetic-retry-owner';
    expect((await processRetry(queued as StoredMessage)).status).toBe('OUT-SENT');
    expect(local.received).toHaveLength(2);
    expect(local.received[1].body).toBe(local.received[0].body);
    expect(local.received[1].body).toContain('<PatientID>SYNTHETIC-001</PatientID>');
    expect(local.received[1].headers['content-type']).toMatch(/^application\/xml(?:;|$)/);
    expect(state.attempts.map((attempt) => attempt.httpStatus)).toEqual([500, 200]);
    expect(queued.retry_count).toBe(1);
    expect(queued.next_retry_at).toBeNull();
  });

  it('does not automatically retry a permanent HTTP 400 delivery failure', async () => {
    const local = await receiver({ statuses: [400] });
    state.destinations = [destination(local.endpoint)];
    expect((await processInboundMessage(1, input())).inboundStatus).toBe('FAILED');
    expect(local.received).toHaveLength(1);
    expect(outboundRows()[0]).toMatchObject({
      status: 'OUT-ERROR',
      next_retry_at: null,
      retry_count: 0,
      last_error: 'HTTP_400',
    });
    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0]).toMatchObject({ httpStatus: 400, response: 'HTTP_400' });
  });

  it('queues a retry for a temporary HTTP 429 response using the configured retry interval', async () => {
    const local = await receiver({ statuses: [429] });
    state.destinations = [destination(local.endpoint, { retry_interval_seconds: 2 })];
    const before = Date.now();
    expect((await processInboundMessage(1, input())).inboundStatus).toBe('QUEUED');
    expect(local.received).toHaveLength(1);
    const row = outboundRows()[0];
    expect(row).toMatchObject({ status: 'QUEUED', retry_count: 0, last_error: 'HTTP_429' });
    expect(row.next_retry_at!.getTime()).toBeGreaterThanOrEqual(before + 2000);
    expect(state.attempts[0]).toMatchObject({ httpStatus: 429, response: 'HTTP_429' });
  });

  it('allows an explicit resend of a prepared delivery failure using its saved final body', async () => {
    const local = await receiver({ statuses: [500, 200] });
    state.destinations = [
      destination(local.endpoint, {
        retry_enabled: false,
        processing_script: 'return { receiverId: msg.patient_id };',
      }),
    ];
    expect((await processInboundMessage(1, input())).inboundStatus).toBe('FAILED');
    const failed = outboundRows()[0];
    expect(failed.status).toBe('OUT-ERROR');
    expect(JSON.parse(decrypt(failed.transport_config!))).toMatchObject({ preparation_version: 1 });
    expect((await resendMessage(failed.id)).status).toBe('OUT-SENT');
    expect(local.received).toHaveLength(2);
    expect(local.received[1].body).toBe(local.received[0].body);
    expect(JSON.parse(local.received[1].body)).toEqual({ receiverId: 'SYNTHETIC-001' });
    expect(failed.retry_count).toBe(1);
  });

  it.each(['SCRIPT_EXECUTION_FAILED', 'DELIVERY_OUTCOME_UNKNOWN'])(
    'rejects an unsafe historical resend without verified final-payload evidence (%s)',
    async (error) => {
      const local = await receiver();
      const dest = destination(local.endpoint);
      state.destinations = [dest];
      const historical: MessageRow = {
        id: 20,
        channel_id: 1,
        destination_id: dest.id,
        inbound_message_id: 19,
        original_payload: JSON.stringify(input()),
        transformed_payload: JSON.stringify(input()),
        status: 'OUT-ERROR',
        retry_count: 0,
        correlation_id: 'synthetic-historical-correlation',
        transport_config: encrypt(JSON.stringify(dest)),
        last_error: error,
        next_retry_at: null,
      };
      state.messages.set(historical.id, historical);
      await expect(resendMessage(historical.id)).rejects.toMatchObject({
        code: 'DESTINATION_NOT_PREPARED',
      });
      expect(local.received).toEqual([]);
      expect(state.attempts).toEqual([]);
      expect(state.writes.some((write) => write.sql.includes("status='RETRYING'"))).toBe(false);
    },
  );

  it('applies the configured request timeout and quarantines an uncertain delivery outcome', async () => {
    const local = await receiver({ silent: true });
    state.destinations = [destination(local.endpoint, { timeout_ms: 40 })];
    expect((await processInboundMessage(1, input())).inboundStatus).toBe('FAILED');
    expect(local.received).toHaveLength(1);
    expect(outboundRows()[0]).toMatchObject({ status: 'DEAD_LETTER', next_retry_at: null });
    expect(state.attempts[0].httpStatus).toBeNull();
    expect(['DESTINATION_TIMEOUT', 'ECONNABORTED']).toContain(state.attempts[0].response);
    expect(state.attempts[0].requestDurationMs).toBeGreaterThanOrEqual(20);
    expect(state.attempts[0].requestDurationMs).toBeLessThan(1000);
  });

  it.each(['circuit', 'capacity'] as const)(
    'retains %s protection after filtering without inventing HTTP attempt metadata',
    async (protection) => {
      const local = await receiver();
      state.destinations = [destination(local.endpoint, { filter_script: laboratoryFilter })];
      if (protection === 'circuit') state.open.add(2);
      else state.full = true;
      expect((await processInboundMessage(1, input())).inboundStatus).toBe('QUEUED');
      expect(local.received).toEqual([]);
      expect(outboundRows()[0].status).toBe('QUEUED');
      expect(state.attempts[0]).toMatchObject({
        httpStatus: null,
        requestDurationMs: null,
        response: protection === 'circuit' ? 'DESTINATION_CIRCUIT_OPEN' : 'DELIVERY_CAPACITY',
      });
    },
  );
  it.each(['INVALID_ENDPOINT', 'DESTINATION_HOST_DENIED', 'DESTINATION_ADDRESS_DENIED'])(
    'does not count or retry a pre-network rejection (%s)',
    async (code) => {
      const local = await receiver();
      const previousHosts = config.transport.allowedHosts;
      try {
        config.transport.allowedHosts = code === 'DESTINATION_HOST_DENIED' ? ['localhost'] : [];
        state.destinations = [
          destination(code === 'INVALID_ENDPOINT' ? 'file:///synthetic' : local.endpoint),
        ];
        expect((await processInboundMessage(1, input())).inboundStatus).toBe('FAILED');
        expect(local.received).toEqual([]);
        expect(outboundRows()[0]).toMatchObject({
          status: 'OUT-ERROR',
          next_retry_at: null,
          retry_count: 0,
        });
        expect(state.attempts[0]).toMatchObject({
          response: code,
          requestDurationMs: null,
          httpStatus: null,
        });
        // Preparation succeeded; this policy event must never be confused with a failed mapping.
        expect(JSON.parse(decrypt(outboundRows()[0].transport_config!))).toMatchObject({
          preparation_version: 1,
        });
      } finally {
        config.transport.allowedHosts = previousHosts;
      }
    },
  );
});
