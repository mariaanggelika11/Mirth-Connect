import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
const state = vi.hoisted(() => ({ role: 'ADMIN', audit: [] as Record<string, unknown>[] }));
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
              ? [{ id: 1, name: 'Synthetic author', role: state.role }]
              : [],
          };
        },
      };
    },
  }),
  withTransaction: vi.fn(),
}));
import app from '../src/app.js';
import { signToken } from '../src/services/auth.services.js';
import { collectFields, discoverMessageFields } from '../src/services/fieldDiscovery.services.js';
import { compileFieldMapping } from '../src/utils/fieldMapping.js';
const token = signToken({ id: 1, name: 'Synthetic author', role: 'ADMIN' });
const endpoint = '/api/channel/discover-fields';
const sample =
  'MSH|^~\\&|SYNTHETIC|TEST|RECEIVER|TEST|20261018220000||ADT^A04|SYNTHETIC-001|T|2.5\rPID|1||SYNTHETIC-A~SYNTHETIC-B||Patient^Example\rOBX|1|ST|SYNTHETIC||one\rOBX|2|ST|SYNTHETIC||two\r';
const flatten = (fields: ReturnType<typeof collectFields>['fields']): string[] =>
  fields.flatMap((field) => [field.path, ...flatten(field.children || [])]);
beforeEach(() => {
  state.role = 'ADMIN';
  state.audit = [];
});
describe('Bounded actual parser field discovery without sample persistence or values', () => {
  it('discovers JSON nesting arrays and XML attribute paths using runtime representations', async () => {
    const json = await discoverMessageFields(
      'JSON',
      JSON.stringify({
        patient: { id: 'SYNTHETIC_PRIVATE', names: [{ first: 'EXAMPLE_PRIVATE' }] },
      }),
    );
    expect(flatten(json.fields)).toContain('patient.names.0.first');
    expect(JSON.stringify(json)).not.toMatch(/SYNTHETIC_PRIVATE|EXAMPLE_PRIVATE/);
    const xml = await discoverMessageFields(
      'XML',
      '<Patient id="SYNTHETIC_PRIVATE"><name>EXAMPLE_PRIVATE</name></Patient>',
    );
    expect(flatten(xml.fields)).toContain('Patient.$.id');
    expect(flatten(xml.fields)).toContain('Patient.name');
    expect(JSON.stringify(xml)).not.toMatch(/SYNTHETIC_PRIVATE|EXAMPLE_PRIVATE/);
  });
  it('resolves HL7 field repetitions and repeated segments with actual numeric-index paths', async () => {
    const result = await discoverMessageFields('HL7V2', sample);
    expect(flatten(result.fields)).toEqual(
      expect.arrayContaining(['PID.3.0', 'PID.3.1', 'PID.5.2', 'OBX.0.5', 'OBX.1.5']),
    );
    expect(JSON.stringify(result.fields)).toContain('Patient');
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC-A');
  });
  it('offers fields of the actual source mapping while never changing the source sample', async () => {
    const script = compileFieldMapping({
      version: 1,
      rows: [{ source: 'patient.id', target: 'PatientID', required: true }],
    });
    const payload = { patient: { id: 'SYNTHETIC_PRIVATE' } };
    const result = await discoverMessageFields('JSON', payload, script);
    expect(flatten(result.fields)).toContain('patient.id');
    expect(flatten(result.processedFields)).toEqual(['PatientID']);
    expect(payload).toEqual({ patient: { id: 'SYNTHETIC_PRIVATE' } });
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE');
  });
  it('bounds node count and skips prototype paths without interpreting field expressions', () => {
    const result = collectFields(
      JSON.parse(
        '{"__proto__":{"private":"SYNTHETIC"},"constructor":{"prototype":1},"literal.dot":2,"items":' +
          JSON.stringify(Array.from({ length: 700 }, (_, id) => ({ id }))) +
          '}',
      ),
    );
    const paths = flatten(result.fields);
    expect(paths.length).toBeLessThanOrEqual(512);
    expect(paths.some((path) => path.includes('__proto__') || path.includes('constructor'))).toBe(
      false,
    );
    expect(result.fields.find((field) => field.path === 'literal.dot')?.selectable).toBe(false);
    expect(result.truncated).toBe(true);
  });
  it.each([
    ['JSON', '{', 'JSON_INVALID'],
    ['XML', '<Patient>', 'XML_INVALID'],
    ['XML', '<!DOCTYPE x><Patient/>', 'XML_ENTITIES_DENIED'],
    ['HL7V2', 'PID|1', 'INVALID_HL7'],
  ])('rejects invalid %s using bounded runtime parser', async (format, payload, code) => {
    await expect(discoverMessageFields(format, payload)).rejects.toMatchObject({ code });
  });
  it('keeps plain text explicit without invented structure', async () => {
    expect((await discoverMessageFields('TEXT', 'SYNTHETIC_TEXT')).fields).toEqual([]);
  });
  it('requires authentication and checks current database permissions', async () => {
    expect(
      (
        await request(app)
          .post(endpoint)
          .send({ format: 'JSON', payload: { id: 1 } })
      ).status,
    ).toBe(401);
    for (const role of ['VIEWER', 'OPERATOR']) {
      state.role = role;
      expect(
        (
          await request(app)
            .post(endpoint)
            .set('Authorization', 'Bearer ' + token)
            .send({ format: 'JSON', payload: { id: 1 } })
        ).status,
      ).toBe(403);
    }
    expect(state.audit).toEqual([]);
  });
  it('audits successful discovery without storing sample values or scripts', async () => {
    for (const role of ['ADMIN', 'DEVELOPER']) {
      state.role = role;
      const response = await request(app)
        .post(endpoint)
        .set('Authorization', 'Bearer ' + token)
        .send({ format: 'JSON', payload: '{"patient":{"id":"SYNTHETIC_PRIVATE"}}' });
      expect(response.status).toBe(200);
      expect(response.body.fields[0].path).toBe('patient');
      expect(JSON.stringify(response.body)).not.toContain('SYNTHETIC_PRIVATE');
    }
    expect(state.audit).toHaveLength(2);
    expect(state.audit[0].action).toBe('DISCOVER_MESSAGE_FIELDS');
    expect(JSON.stringify(state.audit)).not.toContain('SYNTHETIC_PRIVATE');
  });
  it('returns safe errors for invalid input or sandbox failure', async () => {
    expect(
      (
        await request(app)
          .post(endpoint)
          .set('Authorization', 'Bearer ' + token)
          .send({ format: 'INVALID', payload: 1 })
      ).body.code,
    ).toBe('FIELD_DISCOVERY_INVALID');
    const response = await request(app)
      .post(endpoint)
      .set('Authorization', 'Bearer ' + token)
      .send({
        format: 'JSON',
        payload: {},
        processingScript: 'throw new Error("SYNTHETIC_PRIVATE_ERROR");',
      });
    expect(response.status).toBe(422);
    expect(JSON.stringify(response.body)).not.toContain('SYNTHETIC_PRIVATE_ERROR');
  });
});
