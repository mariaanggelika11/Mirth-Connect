import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type * as DnsPromises from 'node:dns/promises';
import type * as Transport from '../src/utils/transport.js';

const state = vi.hoisted(() => ({
  role: 'ADMIN',
  audit: [] as Record<string, unknown>[],
  lookup: vi.fn(),
  send: vi.fn(async () => {
    throw new Error('Transformation preview must not send data');
  }),
  probe: vi.fn(async () => {
    throw new Error('Transformation preview must not probe connections');
  }),
}));
vi.mock('../src/config/db.js', () => ({
  getConnection: async () => ({
    request: () => {
      const inputs: Record<string, unknown> = {};
      return {
        input(key: string, value: unknown) {
          inputs[key] = value;
          return this;
        },
        async query(sql: string) {
          if (sql.includes('INSERT INTO "AuditLog"')) state.audit.push({ ...inputs });
          return {
            recordset: sql.includes('SELECT id,name,role')
              ? [{ id: 1, name: 'Synthetic operator', role: state.role }]
              : [],
          };
        },
      };
    },
  }),
  withTransaction: vi.fn(),
}));
vi.mock('node:dns/promises', async (original) => ({
  ...(await original<typeof DnsPromises>()),
  lookup: state.lookup,
}));
vi.mock('../src/utils/transport.js', async (original) => {
  const transport = await original<typeof Transport>();
  return {
    ...transport,
    validateEndpoint: vi.fn(transport.validateEndpoint),
    sendRest: state.send,
    sendTcp: state.send,
    testConnection: state.probe,
  };
});

import app from '../src/app.js';
import { signToken } from '../src/services/auth.services.js';
import { compileFieldMapping } from '../src/utils/fieldMapping.js';
import { validateEndpoint } from '../src/utils/transport.js';
import { sample } from './fixtures.js';

const token = signToken({ id: 1, name: 'Synthetic operator', role: 'ADMIN' });
const basePath = '/api/channel/preview-transformation';
const configuration = () => ({
  name: 'Synthetic mapping draft',
  source: { type: 'HTTP', inboundDataType: 'JSON' },
  processingScript: compileFieldMapping({
    version: 1,
    rows: [{ source: 'patient_id', target: 'PatientID', required: true }],
    rootElement: 'Patient',
  }),
  destinations: [
    { name: '', type: 'REST', endpoint: '', outboundDataType: 'XML', isEnabled: true },
  ],
});
const payload = () => ({ patient_id: 'SYNTHETIC-PRIVATE-ID' });
const preview = (body: unknown, path = basePath) =>
  request(app)
    .post(path)
    .set('Authorization', 'Bearer ' + token)
    .send(body);

beforeEach(() => {
  state.role = 'ADMIN';
  state.audit = [];
});

describe('Transformation-only preview before destination connection setup', () => {
  it('previews the actual mapped XML with empty destination fields and performs no network work', async () => {
    const response = await preview({
      configuration: configuration(),
      payload: payload(),
      raw: true,
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      accepted: true,
      networkDelivery: 'NOT_SENT',
      source: {
        transformation: 'TRANSFORMED',
        payload: { Patient: { PatientID: 'SYNTHETIC-PRIVATE-ID' } },
      },
      results: [{ name: 'Destination 1', outputFormat: 'XML', routed: true, status: 'VALID' }],
    });
    expect(response.body.results[0].finalPayload).toContain(
      '<PatientID>SYNTHETIC-PRIVATE-ID</PatientID>',
    );
    expect(response.body.warnings).toContain(
      'Connection settings are not validated by transformation preview.',
    );
    expect(validateEndpoint).not.toHaveBeenCalled();
    expect(state.lookup).not.toHaveBeenCalled();
    expect(state.send).not.toHaveBeenCalled();
    expect(state.probe).not.toHaveBeenCalled();
    expect(state.audit).toHaveLength(1);
    expect(state.audit[0].action).toBe('TRANSFORMATION_PREVIEW_RAW');
    expect(JSON.stringify(state.audit)).not.toContain('SYNTHETIC-PRIVATE-ID');
  });

  it('accepts missing destination name/endpoint but keeps full dry-run connection validation', async () => {
    const config = {
      ...configuration(),
      destinations: [{ type: 'REST', outboundDataType: 'XML' }],
    };
    expect((await preview({ configuration: config, payload: payload() })).status).toBe(200);
    const full = await preview(
      { configuration: config, payload: payload() },
      '/api/channel/dry-run',
    );
    expect(full.status).toBe(400);
    expect(full.body.code).toBe('DRY_RUN_INVALID');

    const host = {
      ...configuration(),
      destinations: [
        {
          ...configuration().destinations[0],
          name: 'Synthetic destination',
          endpoint: 'http://169.254.169.254',
        },
      ],
    };
    const fullHost = await preview(
      { configuration: host, payload: payload() },
      '/api/channel/dry-run',
    );
    expect(fullHost.status).toBe(200);
    expect(fullHost.body).toMatchObject({
      success: false,
      results: [{ status: 'ERROR', code: 'DESTINATION_HOST_DENIED' }],
    });
    expect(validateEndpoint).toHaveBeenCalled();
  });

  it('honestly skips invalid connection strings during transformation-only preview', async () => {
    const config = configuration();
    config.destinations[0].endpoint = 'not configured yet';
    const response = await preview({ configuration: config, payload: payload() });
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.networkDelivery).toBe('NOT_SENT');
    expect(response.body.results[0].deliveryResult).toBeUndefined();
    expect(response.body.results[0].httpStatus).toBeUndefined();
    expect(validateEndpoint).not.toHaveBeenCalled();
  });

  it('masks previews by default and limits raw preview to administrators', async () => {
    state.role = 'DEVELOPER';
    const config = { ...configuration(), processingScript: '' };
    const body = { configuration: config, payload: { patientName: 'SYNTHETIC_PRIVATE_NAME' } };
    const masked = await preview(body);
    expect(masked.status).toBe(200);
    expect(masked.body.rawPayload).toBe(false);
    expect(masked.body.input.payload.patientName).toBe('[REDACTED]');
    expect(masked.body.results[0].finalPayload).toBe('[REDACTED TEXT]');
    expect(JSON.stringify(masked.body)).not.toContain('SYNTHETIC_PRIVATE_NAME');
    expect(state.audit[0].action).toBe('TRANSFORMATION_PREVIEW');
    const denied = await preview({ ...body, raw: true });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('RAW_PAYLOAD_DENIED');
    const queryDenied = await preview(body, basePath + '?raw=true');
    expect(queryDenied.status).toBe(403);
    expect(state.audit).toHaveLength(1);
  });

  it('requires authentication and channel write permission using the current database role', async () => {
    expect((await request(app).post(basePath).send({})).status).toBe(401);
    for (const role of ['VIEWER', 'OPERATOR']) {
      state.role = role;
      expect((await preview({ configuration: configuration(), payload: payload() })).status).toBe(
        403,
      );
    }
    expect(state.audit).toHaveLength(0);
  });

  it('bounds incomplete drafts and retains schema validation for runtime options', async () => {
    const destination = configuration().destinations[0];
    for (const patch of [
      { endpoint: 'x'.repeat(2049) },
      { name: 'x'.repeat(151) },
      { type: 'UNSUPPORTED' },
      { timeoutMs: 1 },
      { maxRetries: 11 },
      { processingScript: 'x'.repeat(65537) },
      { deliveryPolicy: { maxConcurrency: 101 } },
    ]) {
      const response = await preview({
        configuration: { ...configuration(), destinations: [{ ...destination, ...patch }] },
        payload: payload(),
      });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('TRANSFORMATION_PREVIEW_INVALID');
    }
    expect(
      (
        await preview({
          configuration: {
            ...configuration(),
            destinations: Array.from({ length: 51 }, () => destination),
          },
          payload: payload(),
        })
      ).status,
    ).toBe(400);
    expect((await preview({ configuration: configuration() })).status).toBe(400);
    expect(state.audit).toHaveLength(0);
  });

  it('reports real transformation/conversion failures without exposing script exception text', async () => {
    const source = await preview({
      configuration: {
        ...configuration(),
        processingScript: 'throw new Error("SYNTHETIC_PRIVATE");',
      },
      payload: payload(),
    });
    expect(source.status).toBe(200);
    expect(source.body).toMatchObject({
      success: false,
      source: {
        transformation: 'ERROR',
        code: 'SCRIPT_EXECUTION_FAILED',
        message:
          'Transformation failed. Check the field mapping or advanced transformation script.',
      },
      results: [],
    });
    expect(JSON.stringify(source.body)).not.toContain('SYNTHETIC_PRIVATE"');
    const conversion = await preview({
      configuration: {
        ...configuration(),
        destinations: [{ ...configuration().destinations[0], outboundDataType: 'HL7V2' }],
      },
      payload: payload(),
    });
    expect(conversion.status).toBe(200);
    expect(conversion.body).toMatchObject({
      success: false,
      results: [
        {
          status: 'ERROR',
          stages: { conversion: 'ERROR' },
          message:
            'Cannot generate HL7 output. Map the required MSH header fields and check the output structure.',
        },
      ],
    });
  });

  it('keeps source filtering, per-destination transformation, and multi-destination routing', async () => {
    const config = {
      ...configuration(),
      destinations: [
        {
          ...configuration().destinations[0],
          processingScript: 'msg.Patient.DestinationMarker = "FIRST"; return msg;',
        },
        { ...configuration().destinations[0], filterScript: 'return false;' },
      ],
    };
    const mapped = await preview({ configuration: config, payload: payload(), raw: true });
    expect(mapped.status).toBe(200);
    expect(mapped.body.results[0].finalPayload).toContain(
      '<DestinationMarker>FIRST</DestinationMarker>',
    );
    expect(mapped.body.results[1]).toMatchObject({
      name: 'Destination 2',
      routed: false,
      stages: { filter: 'FILTERED' },
    });
    const filtered = await preview({
      configuration: { ...config, filterScript: 'return false;' },
      payload: payload(),
    });
    expect(filtered.status).toBe(200);
    expect(filtered.body).toMatchObject({
      accepted: false,
      source: { filter: 'FILTERED', transformation: 'SKIPPED' },
    });
    expect(filtered.body.results.every((result: { routed: boolean }) => !result.routed)).toBe(true);
    expect(state.send).not.toHaveBeenCalled();
    expect(state.lookup).not.toHaveBeenCalled();
  });
});

describe('Actionable preview errors with sanitized configuration metadata', () => {
  for (const [patch, message] of [
    [{ name: '' }, 'Enter a channel name in Source before testing.'],
    [
      { source: { type: 'HTTP', inboundDataType: 'SYNTHETIC_PRIVATE_FORMAT' } },
      'Select a supported input format in Source.',
    ],
    [
      {
        destinations: [
          { ...configuration().destinations[0], outboundDataType: 'SYNTHETIC_PRIVATE_FORMAT' },
        ],
      },
      'Destination 1: choose a valid outbound format.',
    ],
    [
      { validationProfile: 'SYNTHETIC_PRIVATE_SCHEMA' },
      'The custom validation schema must be a JSON object. Check its settings in Advanced source settings.',
    ],
    [
      { destinations: [{ ...configuration().destinations[0], timeoutMs: 1 }] },
      'Destination 1: set the timeout between 0.1 and 120 seconds.',
    ],
  ] as const)
    it(`explains invalid configuration: ${message}`, async () => {
      const response = await preview({
        configuration: { ...configuration(), ...patch },
        payload: payload(),
      });
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        success: false,
        code: 'TRANSFORMATION_PREVIEW_INVALID',
        message,
        details: [],
      });
      expect(JSON.stringify(response.body)).not.toContain('SYNTHETIC_PRIVATE');
      expect(state.send).not.toHaveBeenCalled();
      expect(state.lookup).not.toHaveBeenCalled();
      expect(state.audit).toHaveLength(0);
    });

  it('asks for a synthetic sample instead of a generic configuration error', async () => {
    const response = await preview({ configuration: configuration() });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      'Enter a synthetic sample message in Review before testing.',
    );
  });

  it('identifies the first missing required mapping target without returning a payload value', async () => {
    const response = await preview({
      configuration: configuration(),
      payload: { patientName: 'SYNTHETIC_PRIVATE_NAME' },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: false,
      source: {
        validation: 'PASSED',
        filter: 'ACCEPTED',
        transformation: 'ERROR',
        code: 'SCRIPT_EXECUTION_FAILED',
        message: 'Target field PatientID is required.',
      },
      networkDelivery: 'NOT_SENT',
      results: [],
    });
    expect(JSON.stringify(response.body)).not.toContain('SYNTHETIC_PRIVATE_NAME');
    expect(state.send).not.toHaveBeenCalled();
    expect(state.lookup).not.toHaveBeenCalled();
  });

  it('applies mapping defaults before identifying a missing target and keeps zero/false values valid', async () => {
    const config = {
      ...configuration(),
      processingScript: compileFieldMapping({
        version: 1,
        rootElement: 'Patient',
        rows: [
          {
            source: 'patient_id',
            target: 'PatientID',
            required: true,
            defaultValue: 'SYNTHETIC-DEFAULT',
          },
          { source: 'active', target: 'Active', required: true },
        ],
      }),
    };
    const missing = await preview({ configuration: config, payload: {} });
    expect(missing.body.source.message).toBe('Target field Active is required.');
    const valid = await preview({
      configuration: config,
      payload: { patient_id: 0, active: false },
      raw: true,
    });
    expect(valid.body.success).toBe(true);
    expect(valid.body.source.payload).toEqual({ Patient: { PatientID: 0, Active: false } });
    expect(valid.body.source.message).toBeUndefined();
  });

  for (const [inboundDataType, input, sourceField] of [
    ['XML', '<Patient><Name>SYNTHETIC_PRIVATE_NAME</Name></Patient>', 'Patient.ID'],
    ['HL7V2', sample, 'OBX.99'],
  ])
    it(`identifies required fields using the existing bounded ${inboundDataType} mapping pipeline`, async () => {
      const response = await preview({
        configuration: {
          ...configuration(),
          source: { type: 'HTTP', inboundDataType },
          processingScript: compileFieldMapping({
            version: 1,
            rootElement: 'Patient',
            rows: [{ source: sourceField, target: 'PatientID', required: true }],
          }),
        },
        payload: input,
      });
      expect(response.status).toBe(200);
      expect(response.body.source.message).toBe('Target field PatientID is required.');
      expect(response.body.source.transformation).toBe('ERROR');
      expect(JSON.stringify(response.body)).not.toContain('SYNTHETIC_PRIVATE_NAME');
    });

  it('does not report mapping requirements for valid messages excluded by the source filter', async () => {
    const response = await preview({
      configuration: { ...configuration(), filterScript: 'return false;' },
      payload: {},
    });
    expect(response.body).toMatchObject({
      success: true,
      accepted: false,
      source: { filter: 'FILTERED', transformation: 'SKIPPED' },
    });
    expect(response.body.source.message).toBeUndefined();
  });

  it('reports a destination-specific missing target without running arbitrary scripts for diagnostics', async () => {
    const response = await preview({
      configuration: {
        ...configuration(),
        processingScript: '',
        destinations: [
          {
            ...configuration().destinations[0],
            processingScript: configuration().processingScript,
          },
        ],
      },
      payload: { patientName: 'SYNTHETIC_PRIVATE_NAME' },
    });
    expect(response.body).toMatchObject({
      success: false,
      source: { transformation: 'PASS_THROUGH' },
      results: [{ status: 'ERROR', message: 'Target field PatientID is required.' }],
    });
    expect(JSON.stringify(response.body)).not.toContain('SYNTHETIC_PRIVATE_NAME');
  });

  it('gives actionable validation and filter errors without exposing custom exceptions or schemas', async () => {
    const filtered = await preview({
      configuration: {
        ...configuration(),
        filterScript: 'throw new Error("SYNTHETIC_PRIVATE_ERROR");',
      },
      payload: payload(),
    });
    expect(filtered.body.source.message).toBe(
      'The filter failed. Review its condition or advanced script.',
    );
    expect(JSON.stringify(filtered.body)).not.toContain('SYNTHETIC_PRIVATE_ERROR');
    const invalidSchema = await preview({
      configuration: {
        ...configuration(),
        validationProfile: { jsonSchema: { type: 'SYNTHETIC_PRIVATE_SCHEMA' } },
      },
      payload: payload(),
    });
    expect(invalidSchema.body.source.message).toBe(
      'The custom JSON Schema is invalid. Review its structure and required fields.',
    );
    expect(JSON.stringify(invalidSchema.body)).not.toContain('SYNTHETIC_PRIVATE_SCHEMA');
  });
});
