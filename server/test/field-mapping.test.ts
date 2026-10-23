import { describe, expect, it } from 'vitest';
import {
  compileFieldMapping,
  readFieldMapping,
  validateFieldMapping,
} from '../src/utils/fieldMapping.js';
import type { FieldMappingConfig } from '../src/utils/fieldMapping.js';
import { executeScript } from '../src/services/script.services.js';
import { convertPayload } from '../src/services/engine/conversion.js';
import { channelSchema } from '../src/utils/validator.js';
import { runConfiguration } from '../src/services/dryRun.services.js';
import { sample } from './fixtures.js';

const mapping = (): FieldMappingConfig => ({
  version: 1,
  rows: [
    { source: 'patient_id', target: 'PatientID', required: true },
    { source: 'name', target: 'PatientName', required: true },
    { source: 'gender', target: 'Gender', required: false, defaultValue: 'U' },
    { source: 'date_of_birth', target: 'BirthDate', required: false },
  ],
  rootElement: 'Patient',
});
const synthetic = {
  patient_id: 'SYNTHETIC-001',
  name: 'Synthetic Patient',
  gender: 'F',
  date_of_birth: '2000-01-01',
};

describe('Safe visual field mapping configuration', () => {
  it('round trips canonical metadata and does not recognize custom or changed scripts', () => {
    const config = mapping();
    const script = compileFieldMapping(config);
    expect(readFieldMapping(script)).toEqual(config);
    expect(readFieldMapping('msg = { legacy: msg };')).toBeNull();
    expect(readFieldMapping(script + '\nmsg.extra = true;')).toBeNull();
    expect(
      readFieldMapping(script.replace('var mappingInput = msg;', 'var mappingInput = {};')),
    ).toBeNull();
    expect(readFieldMapping('/* MIRTH_FIELD_MAPPING_V1:%invalid */\n')).toBeNull();
    expect(readFieldMapping('/* MIRTH_FIELD_MAPPING_V1:')).toBeNull();
    expect(readFieldMapping('x'.repeat(65537))).toBeNull();
  });

  it('normalizes whitespace without retaining unrelated metadata', () => {
    expect(
      validateFieldMapping({
        version: 1,
        rows: [{ source: ' person.name ', target: ' Name ', required: false }],
        rootElement: '',
      }),
    ).toEqual({
      version: 1,
      rows: [{ source: 'person.name', target: 'Name', required: false }],
    });
    expect(() => validateFieldMapping({ ...mapping(), unexpected: true })).toThrow(
      'Invalid field mapping configuration.',
    );
  });

  it('rejects prototype paths on input, output, and root without echoing payload values', () => {
    for (const forbidden of ['__proto__', 'constructor', 'prototype']) {
      for (const property of ['source', 'target']) {
        const config = mapping();
        config.rows[0] = { ...config.rows[0], [property]: 'patient.' + forbidden + '.name' };
        expect(() => compileFieldMapping(config)).toThrow('field path');
      }
      expect(() => compileFieldMapping({ ...mapping(), rootElement: forbidden })).toThrow(
        'valid XML root',
      );
    }
    expect({}).not.toHaveProperty('polluted');
  });

  it('bounds mappings, path depth, defaults, root names, and total script size', () => {
    expect(() => validateFieldMapping(null)).toThrow('Invalid field mapping');
    expect(() => validateFieldMapping({ version: 3, rows: [] })).toThrow('Invalid field mapping');
    expect(() => compileFieldMapping({ version: 1, rows: [] })).toThrow('1 and 100');
    expect(() =>
      compileFieldMapping({
        version: 1,
        rows: Array.from({ length: 101 }, () => mapping().rows[0]),
      }),
    ).toThrow('1 and 100');
    for (const source of [
      '',
      'a..b',
      'person[0]',
      'name()',
      'a.'.repeat(12) + 'z',
      'x'.repeat(257),
    ])
      expect(() =>
        compileFieldMapping({ version: 1, rows: [{ source, target: 'out', required: true }] }),
      ).toThrow('field path');
    expect(() =>
      compileFieldMapping({
        version: 1,
        rows: [{ source: 'name', target: 'out', required: false, defaultValue: 'x'.repeat(1025) }],
      }),
    ).toThrow('1024 characters');
    expect(() => compileFieldMapping({ ...mapping(), rootElement: '<Patient>' })).toThrow(
      'valid XML root',
    );
    expect(() =>
      compileFieldMapping({
        version: 1,
        rows: Array.from({ length: 100 }, (_, index) => ({
          source: 'source' + index,
          target: 'target' + index,
          required: false,
          defaultValue: 'x'.repeat(1024),
        })),
      }),
    ).toThrow('size limit');
  });

  it('rejects duplicate and ancestor output paths in either order', () => {
    for (const targets of [
      ['Patient', 'Patient'],
      ['Patient', 'Patient.Name'],
      ['Patient.Name', 'Patient'],
    ])
      expect(() =>
        compileFieldMapping({
          version: 1,
          rows: targets.map((target) => ({ source: 'name', target, required: false })),
        }),
      ).toThrow('must not overlap');
  });

  it('rejects malformed row settings and non-string defaults', () => {
    for (const row of [
      null,
      { source: 'name', target: 'Name', required: 'yes' },
      { source: 'name', target: 'Name', required: false, defaultValue: { secret: 'SYNTHETIC' } },
      { source: 'name', target: 'Name', required: false, unexpected: true },
      { source: null, target: 'Name', required: true },
    ])
      expect(() => validateFieldMapping({ version: 1, rows: [row] })).toThrow();
  });
});

describe('Visual mappings execute in the existing QuickJS pipeline', () => {
  it('maps the four patient fields and converts to the actual XML delivery format', async () => {
    const transformed = await executeScript(compileFieldMapping(mapping()), { msg: synthetic });
    expect(transformed).toEqual({
      Patient: {
        PatientID: 'SYNTHETIC-001',
        PatientName: 'Synthetic Patient',
        Gender: 'F',
        BirthDate: '2000-01-01',
      },
    });
    const xml = await convertPayload(transformed, 'XML');
    expect(xml).toContain('<Patient>');
    expect(xml).toContain('<PatientID>SYNTHETIC-001</PatientID>');
    expect(xml).toContain('<PatientName>Synthetic Patient</PatientName>');
    expect(xml).not.toContain('<patient_id>');
  });

  it('accepts JSON text and preserves falsy values while applying defaults only when missing', async () => {
    const config: FieldMappingConfig = {
      version: 1,
      rows: [
        { source: 'items.0.count', target: 'result.count', required: true, defaultValue: '99' },
        { source: 'enabled', target: 'result.enabled', required: true, defaultValue: 'yes' },
        { source: 'missing', target: 'result.fallback', required: true, defaultValue: 'default' },
        { source: 'missingToo', target: 'result.omitted', required: false },
        { source: 'empty', target: 'result.empty', required: false, defaultValue: '' },
      ],
    };
    expect(
      await executeScript(compileFieldMapping(config), {
        msg: JSON.stringify({ items: [{ count: 0 }], enabled: false, empty: null }),
      }),
    ).toEqual({ result: { count: 0, enabled: false, fallback: 'default', empty: '' } });
  });

  it('allows sibling nested targets and keeps unmapped input fields out of output', async () => {
    expect(
      await executeScript(
        compileFieldMapping({
          version: 1,
          rows: [
            { source: 'patient.name', target: 'Patient.Name', required: true },
            { source: 'patient.age', target: 'Patient.Age', required: false },
          ],
        }),
        { msg: { patient: { name: 'Synthetic', age: 25 }, excluded: 'SYNTHETIC_PRIVATE' } },
      ),
    ).toEqual({ Patient: { Name: 'Synthetic', Age: 25 } });
  });

  it('maps HL7 components and repeated segments through the existing HL7 parser', async () => {
    const config: FieldMappingConfig = {
      version: 1,
      rows: [
        { source: 'PID.3', target: 'PatientID', required: true },
        { source: 'PID.5.2', target: 'GivenName', required: true },
        { source: 'OBX.1.5', target: 'SecondObservation', required: true },
      ],
    };
    expect(await executeScript(compileFieldMapping(config), { msg: sample })).toEqual({
      PatientID: 'MR123',
      GivenName: 'JANE',
      SecondObservation: 'test',
    });
  });

  it('maps XML input through the protected parser and serializes the new destination XML', async () => {
    const script = compileFieldMapping({
      version: 1,
      rows: [{ source: 'Patient.name', target: 'FullName', required: true }],
      rootElement: 'Result',
    });
    const transformed = await executeScript(script, {
      msg: '<Patient><name>Synthetic &amp; Example</name></Patient>',
    });
    expect(transformed).toEqual({ Result: { FullName: 'Synthetic & Example' } });
    expect(await convertPayload(transformed, 'XML')).toContain(
      '<FullName>Synthetic &amp; Example</FullName>',
    );
  });

  it('rejects XML entities and malformed XML while preserving raw XML for custom scripts', async () => {
    const script = compileFieldMapping({
      version: 1,
      rows: [{ source: 'Patient.name', target: 'Name', required: true }],
    });
    await expect(
      executeScript(script, {
        msg: '<!DOCTYPE Patient [<!ENTITY record SYSTEM "file:///SYNTHETIC">]><Patient><name>&record;</name></Patient>',
      }),
    ).rejects.toMatchObject({ code: 'XML_ENTITIES_DENIED' });
    await expect(executeScript(script, { msg: '<Patient><name>Unclosed' })).rejects.toMatchObject({
      code: 'FIELD_MAPPING_INPUT_INVALID',
    });
    expect(
      await executeScript('return { originalType: typeof msg, raw: msg };', {
        msg: '<Patient><name>Synthetic</name></Patient>',
      }),
    ).toEqual({
      originalType: 'string',
      raw: '<Patient><name>Synthetic</name></Patient>',
    });
  });

  it('bounds XML structure even when XML arrives as a JSON string instead of an XML source', async () => {
    const script = compileFieldMapping({
      version: 1,
      rows: [{ source: 'Root.name', target: 'Name', required: false }],
    });
    const deep =
      '<Root>' + '<Node>'.repeat(70) + 'SYNTHETIC_PRIVATE_DEPTH' + '</Node>'.repeat(70) + '</Root>';
    const wide = '<Root>' + '<Node>SYNTHETIC_PRIVATE_WIDTH</Node>'.repeat(20001) + '</Root>';
    for (const msg of [deep, wide]) {
      const failure = await executeScript(script, { msg }).catch((error: unknown) => error);
      expect(failure).toMatchObject({ code: 'FIELD_MAPPING_INPUT_INVALID' });
      expect(String(failure)).not.toContain('SYNTHETIC_PRIVATE');
    }
    for (const inboundDataType of ['JSON', 'XML']) {
      const config = channelSchema.parse({
        name: 'Synthetic XML structure guard',
        source: { type: 'HTTP', inboundDataType },
        processingScript: script,
        destinations: [],
      });
      const result = await runConfiguration(config, deep);
      expect(result.success).toBe(false);
      expect(result.source.code).toBe(
        inboundDataType === 'XML' ? 'XML_INVALID' : 'FIELD_MAPPING_INPUT_INVALID',
      );
      expect(result.results).toEqual([]);
      expect(result.networkDelivery).toBe('NOT_SENT');
    }
  });

  it('can map structured fields to HL7 without changing the existing serializer', async () => {
    const config: FieldMappingConfig = {
      version: 1,
      rows: [
        { source: 'event', target: 'MSH.9', required: true },
        { source: 'controlId', target: 'MSH.10', required: true },
        { source: 'missing', target: 'MSH.11', required: true, defaultValue: 'P' },
        { source: 'missing', target: 'MSH.12', required: true, defaultValue: '2.5' },
        { source: 'patient_id', target: 'PID.3', required: true },
      ],
    };
    const transformed = await executeScript(compileFieldMapping(config), {
      msg: {
        event: { '1': 'ADT', '2': 'A01' },
        controlId: 'SYNTHETIC-MAPPED-HL7',
        patient_id: 'SYNTHETIC-001',
      },
    });
    const hl7 = await convertPayload(transformed, 'HL7V2');
    expect(hl7).toContain('MSH|^~\\&|');
    expect(hl7).toContain('ADT^A01|SYNTHETIC-MAPPED-HL7|P|2.5');
    expect(hl7).toContain('PID|||SYNTHETIC-001');
  });

  it('fails missing required fields and invalid inputs with sanitized sandbox errors', async () => {
    const script = compileFieldMapping(mapping());
    for (const msg of [null, [], true, 'not-json', { name: 'SYNTHETIC_PRIVATE_NAME' }]) {
      const failure = await executeScript(script, { msg }).catch((error: unknown) => error);
      expect(failure).toMatchObject({ code: 'SCRIPT_EXECUTION_FAILED' });
      expect(String(failure)).not.toContain('SYNTHETIC_PRIVATE_NAME');
    }
  });

  it('handles defaults as literal data rather than executable code', async () => {
    const literal = '"; throw new Error("SYNTHETIC"); /* */\n</script> ☺';
    const config: FieldMappingConfig = {
      version: 1,
      rows: [{ source: 'missing', target: 'literal', required: false, defaultValue: literal }],
    };
    expect(readFieldMapping(compileFieldMapping(config))).toEqual(config);
    expect(await executeScript(compileFieldMapping(config), { msg: {} })).toEqual({ literal });
  });

  it('uses the same source mapping before per-destination filters and transformers in dry-run', async () => {
    const configuration = channelSchema.parse({
      name: 'Synthetic visual mapping',
      source: { type: 'HTTP', inboundDataType: 'JSON' },
      processingScript: compileFieldMapping(mapping()),
      destinations: [
        {
          name: 'Patient XML Receiver',
          type: 'REST',
          endpoint: 'http://localhost',
          outboundDataType: 'XML',
          filterScript: 'return Boolean(msg.Patient.PatientID);',
          processingScript: 'msg.Patient.MappedBy = "Destination"; return msg;',
        },
        {
          name: 'Filtered receiver',
          type: 'REST',
          endpoint: 'http://localhost',
          outboundDataType: 'JSON',
          filterScript: 'return false;',
        },
      ],
    });
    const result = await runConfiguration(configuration, synthetic);
    expect(result.success).toBe(true);
    expect(result.source.payload).toEqual({
      Patient: {
        PatientID: 'SYNTHETIC-001',
        PatientName: 'Synthetic Patient',
        Gender: 'F',
        BirthDate: '2000-01-01',
      },
    });
    expect(result.results[0]).toMatchObject({ routed: true, status: 'VALID' });
    expect(result.results[0].finalPayload).toContain('<MappedBy>Destination</MappedBy>');
    expect(result.results[1]).toMatchObject({
      routed: false,
      delivery: 'FILTERED',
      stages: { filter: 'NOT_MATCHED' },
    });
    expect(result.networkDelivery).toBe('NOT_SENT');
  });
});
