import { describe, it, expect } from 'vitest';
import {
  validatePayload,
  validateProfileConfiguration,
} from '../src/services/profileValidation.services.js';
import { sample } from './fixtures.js';
import { buildAck, readAck, parseSegments } from '../src/utils/hl7Converer.js';
import { channelSchema } from '../src/utils/validator.js';
describe('Per-channel synthetic healthcare profiles', () => {
  it('supports basic syntax for JSON data, XML and HL7 without adding a custom schema', async () => {
    const profile = { basicSyntax: true };
    expect(
      channelSchema.parse({
        name: 'Synthetic basic validation',
        source: { type: 'HTTP', inboundDataType: 'JSON' },
        validationProfile: profile,
        destinations: [],
      }).validationProfile,
    ).toEqual(profile);
    for (const payload of [{ message_type: 'ADT' }, ['synthetic'], 'valid scalar', 0, false, null])
      await expect(validatePayload(payload, 'JSON', profile)).resolves.toBeUndefined();
    await expect(
      validatePayload('<Patient><ID>synthetic</ID></Patient>', 'XML', profile),
    ).resolves.toBeUndefined();
    await expect(validatePayload(sample, 'HL7V2', profile)).resolves.toBeUndefined();
  });
  it('rejects invalid basic syntax before filtering and never echoes payload', async () => {
    for (const payload of [undefined, NaN, Infinity, { value: undefined }, { value: 1n }])
      await expect(validatePayload(payload, 'JSON', { basicSyntax: true })).rejects.toMatchObject({
        code: 'JSON_INVALID',
        message: 'JSON payload is invalid',
      });
    await expect(
      validatePayload('<Patient>synthetic', 'XML', { basicSyntax: true }),
    ).rejects.toMatchObject({ code: 'XML_INVALID' });
    await expect(
      validatePayload('PID|synthetic', 'HL7V2', { basicSyntax: true }),
    ).rejects.toMatchObject({ code: 'INVALID_HL7' });
  });
  it('combines basic syntax with existing schema, profile and sandbox validation', async () => {
    await expect(
      validatePayload({}, 'JSON', {
        basicSyntax: true,
        jsonSchema: {
          type: 'object',
          properties: { patient_id: { type: 'string' } },
          required: ['patient_id'],
        },
      }),
    ).rejects.toMatchObject({ code: 'PAYLOAD_SCHEMA_REJECTED' });
    await expect(
      validatePayload('<Other/>', 'XML', { basicSyntax: true, xml: { root: 'Patient' } }),
    ).rejects.toMatchObject({ code: 'XML_PROFILE_REJECTED' });
    await expect(
      validatePayload(sample, 'HL7V2', { basicSyntax: true, script: 'return false;' }),
    ).rejects.toMatchObject({ code: 'PAYLOAD_VALIDATION_REJECTED' });
  });
  for (const type of ['ADT^A01', 'ADT^A08', 'ADT^A40', 'ORM^O01', 'ORU^R01'])
    it('validates synthetic ' + type, async () => {
      const raw = sample.replace('ORU^R01', type).replace('ADT^A01', type);
      await expect(
        validatePayload(raw, 'HL7V2', {
          hl7: { messageTypes: [type], versions: ['2.5'], requiredFields: ['MSH.10', 'PID.3'] },
        }),
      ).resolves.toBeUndefined();
    });
  it('rejects type, version and missing required fields', async () => {
    for (const hl7 of [
      { messageTypes: ['ORM^O01'] },
      { versions: ['9.9'] },
      { requiredFields: ['OBX.99'] },
    ])
      await expect(validatePayload(sample, 'HL7V2', { hl7 })).rejects.toMatchObject({
        code: 'HL7_PROFILE_REJECTED',
      });
  });
  for (const ending of ['\r', '\r\n', '\n'])
    it('preserves control ID using separator ' + JSON.stringify(ending), () =>
      expect(parseSegments(sample.replace(/\r/g, ending)).segments[0].fields[10]).toBe('ID123'),
    );
  for (const code of ['AA', 'AE', 'AR'] as const)
    it('checks synthetic ACK ' + code, () => {
      const ack = buildAck(sample, code, 'Synthetic fixture');
      if (code === 'AA') expect(() => readAck(ack, 'ID123')).not.toThrow();
      else expect(() => readAck(ack, 'ID123')).toThrow();
      expect(() => readAck(ack, 'mismatch')).toThrow();
    });
  it('validates JSON Schema without mutating or printing payload', async () => {
    const jsonSchema = {
      type: 'object',
      properties: { sample: { type: 'string' } },
      required: ['sample'],
      additionalProperties: false,
    };
    validateProfileConfiguration({ jsonSchema });
    await expect(
      validatePayload({ sample: 'synthetic' }, 'JSON', { jsonSchema }),
    ).resolves.toBeUndefined();
    await expect(
      validatePayload({ unexpected: 'synthetic' }, 'JSON', { jsonSchema }),
    ).rejects.toMatchObject({ code: 'PAYLOAD_SCHEMA_REJECTED' });
  });
  it('rejects schemas with expensive patterns or remote references', () => {
    for (const jsonSchema of [
      { type: 'string', pattern: '(a+)+$' },
      { $ref: 'https://example.invalid/schema' },
      { $async: true },
    ])
      expect(() => validateProfileConfiguration({ jsonSchema })).toThrow('unsupported');
    expect(() => validateProfileConfiguration({ jsonSchema: { type: 'unknown' } })).toThrow(
      'Invalid JSON Schema',
    );
  });
  it('sandbox validation rejects payload and XML declarations', async () => {
    await expect(validatePayload({}, 'JSON', { script: 'return false;' })).rejects.toMatchObject({
      code: 'PAYLOAD_VALIDATION_REJECTED',
    });
    await expect(validatePayload('<!DOCTYPE patient>', 'XML')).rejects.toMatchObject({
      code: 'XML_ENTITIES_DENIED',
    });
  });
});
