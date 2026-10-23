import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  compileFieldMapping,
  readFieldMapping,
  validFieldMappingScript,
  validateFieldMapping,
  type FieldMappingRow,
} from '../src/utils/fieldMapping.js';
import {
  defaultHl7Configuration,
  describeHl7Field,
  hl7Templates,
  hl7TargetFields,
  validCalendarDate,
  validHl7Timestamp,
  type Hl7MessageType,
} from '../src/utils/hl7Configuration.js';
import { executeScript } from '../src/services/script.services.js';
import { convertPayload } from '../src/services/engine/conversion.js';
import { hl7ToJson } from '../src/utils/hl7Converer.js';

const row = (source: string, target: string, conversion?: FieldMappingRow['conversion']) => ({
  source,
  target,
  required: true,
  ...(conversion ? { conversion } : {}),
});
const header = (type: Hl7MessageType = 'ADT^A04') => ({
  ...defaultHl7Configuration(type),
  messageDateTime: '20261018220000',
  messageControlId: 'SYNTHETIC-MAPPING-001',
});
const patient = {
  id: 'SYNTHETIC-001',
  surname: 'Synthetic',
  given: 'Patient',
  birth: '2000-02-29',
  sex: 'F',
  order: 'SYNTHETIC-ORDER',
  service: 'SYNTHETIC-TEST',
  value: '12.5',
};
const patientRows = () => [
  row('id', 'PID.3.1'),
  row('surname', 'PID.5.1'),
  row('given', 'PID.5.2'),
  row('birth', 'PID.7', 'DATE_TO_HL7'),
  row('sex', 'PID.8'),
];
const execute = (rows: FieldMappingRow[], msg: unknown) =>
  executeScript(compileFieldMapping({ version: 2, rows }), { msg });

describe('Versioned visual mapping compatibility and safe paths', () => {
  it('preserves published V1 generated script bytes', () => {
    const script = compileFieldMapping({
      version: 1,
      rootElement: 'Patient',
      rows: [
        row('patient_id', 'PatientID'),
        { source: 'name', target: 'PatientName', required: false, defaultValue: 'Synthetic' },
      ],
    });
    expect(createHash('sha256').update(script).digest('hex')).toBe(
      '2324f05f93661dc669a5777917ea4447a7972c20ca138b5eac3a1bd4f668dedc',
    );
  });

  it('round trips canonical V2 and keeps changed generated bodies as legacy scripts', () => {
    const config = { version: 2 as const, rows: [row('id', 'identifier')] };
    const script = compileFieldMapping(config);
    expect(readFieldMapping(script)).toEqual(config);
    expect(readFieldMapping(script + '\nmsg.custom = true;')).toBeNull();
    expect(readFieldMapping('/* MIRTH_FIELD_MAPPING_V2:%invalid */')).toBeNull();
  });

  it('fails closed for changed V2 runtime metadata while retaining ordinary and edited V1 scripts', async () => {
    const canonical = compileFieldMapping({ version: 2, rows: [row('id', 'identifier')] });
    for (const changed of [
      canonical + '\nmsg.extra = true;',
      '/* MIRTH_FIELD_MAPPING_V2:%bad */',
    ]) {
      expect(validFieldMappingScript(changed)).toBe(false);
      await expect(executeScript(changed, { msg: patient })).rejects.toMatchObject({
        code: 'FIELD_MAPPING_CONFIG_INVALID',
      });
    }
    const v1 = compileFieldMapping({ version: 1, rows: [row('id', 'identifier')] });
    const editedV1 = v1.replace(
      'var mappingInput = msg;',
      'var mappingInput = { id: "SYNTHETIC-EDITED" };',
    );
    expect(validFieldMappingScript(editedV1)).toBe(true);
    expect(readFieldMapping(editedV1)).toBeNull();
    expect(await executeScript(editedV1, { msg: patient })).toEqual({
      identifier: 'SYNTHETIC-EDITED',
    });
    expect(await executeScript('return { custom: msg.id };', { msg: patient })).toEqual({
      custom: patient.id,
    });
  });

  it('does not allow a V2 mapping object to bypass strict boolean filter decisions', async () => {
    const script = compileFieldMapping({ version: 2, rows: [row('id', 'identifier')] });
    await expect(executeScript(script, { msg: patient }, 'true')).rejects.toMatchObject({
      code: 'FILTER_RESULT_INVALID',
    });
  });

  it('preserves literal JSON hyphen keys on both source and destination paths', async () => {
    const input = { 'ABC-3': 'SYNTHETIC-LITERAL', MSH: { '1': 'not-a-separator' } };
    expect(await execute([row('ABC-3', 'XYZ-5')], input)).toEqual({
      'XYZ-5': 'SYNTHETIC-LITERAL',
    });
  });

  it('reads top-level arrays and normalizes bracket paths without coercing values', async () => {
    expect(await execute([row('0.value', '0.answer')], [{ value: false }])).toEqual([
      { answer: false },
    ]);
    expect(
      await execute([row('items[0].value', 'answers[0].value')], {
        items: [{ value: 0 }],
      }),
    ).toEqual({ answers: [{ value: 0 }] });
  });

  it('rejects forbidden properties, root conflicts and overlapping paths', () => {
    for (const forbidden of ['__proto__', 'constructor', 'prototype'])
      expect(() =>
        compileFieldMapping({
          version: 2,
          rows: [row('value', 'out.' + forbidden)],
        }),
      ).toThrow('valid target path');
    expect(() =>
      compileFieldMapping({
        version: 2,
        rows: [row('id', '0.id'), row('name', 'name')],
      }),
    ).toThrow('output root');
    expect(() =>
      compileFieldMapping({
        version: 2,
        rows: [row('id', 'patient'), row('name', 'patient.name')],
      }),
    ).toThrow('must not overlap');
    expect(() => compileFieldMapping({ version: 2, rows: [] })).toThrow('1 and 100');
    expect(() =>
      compileFieldMapping({
        version: 2,
        rows: [row('id', 'items.1000')],
      }),
    ).toThrow('0 and 999');
  });

  it('reports missing own source paths without exposing payload values', async () => {
    const secret = 'SYNTHETIC-PRIVATE-NAME';
    await expect(execute([row('missing', 'PatientID')], { name: secret })).rejects.toMatchObject({
      code: 'FIELD_MAPPING_REQUIRED',
      message: 'Source path missing is missing or empty for target PatientID.',
    });
    try {
      await execute([row('birth', 'birthDate', 'DATE_TO_HL7')], { birth: secret });
      expect.fail('Invalid date must be rejected');
    } catch (error) {
      expect(String(error)).toContain('Expected YYYY-MM-DD');
      expect(String(error)).not.toContain(secret);
    }
  });
});

describe('Explicit V2 type conversion in the existing QuickJS sandbox', () => {
  it.each([
    ['NUMBER', '0', 0],
    ['NUMBER', '-1.25e2', -125],
    ['BOOLEAN', 'false', false],
    ['BOOLEAN', 1, true],
    ['TEXT', 0, '0'],
    ['DATE_TO_HL7', '2000-02-29', '20000229'],
    ['DATE_FROM_HL7', '20000229', '2000-02-29'],
  ] as const)('converts %s explicitly', async (conversion, value, expected) => {
    expect(await execute([row('value', 'answer', conversion)], { value })).toEqual({
      answer: expected,
    });
  });

  it.each([
    ['NUMBER', '12mg'],
    ['NUMBER', 'Infinity'],
    ['BOOLEAN', 'yes'],
    ['DATE_TO_HL7', '1900-02-29'],
    ['DATE_TO_HL7', '2000-13-01'],
    ['DATE_FROM_HL7', '20260230'],
  ] as const)('rejects invalid %s without implicit fallback', async (conversion, value) => {
    await expect(execute([row('value', 'answer', conversion)], { value })).rejects.toMatchObject({
      code: 'FIELD_MAPPING_CONVERSION',
    });
  });

  it('distinguishes no conversion, default values and invalid structured input', async () => {
    expect(await execute([{ ...row('absent', 'answer'), defaultValue: 'fallback' }], {})).toEqual({
      answer: 'fallback',
    });
    expect(await execute([row('value', 'answer', 'NONE')], { value: { nested: true } })).toEqual({
      answer: { nested: true },
    });
    await expect(execute([row('value', 'answer')], 'not JSON')).rejects.toMatchObject({
      code: 'FIELD_MAPPING_INPUT_INVALID',
    });
  });
});

describe('Curated HL7 v2.5 templates through the existing serializer', () => {
  it.each(['ADT^A04', 'ADT^A01', 'ORU^R01', 'ORM^O01'] as const)(
    'builds %s with valid headers, ordering and profile requirements',
    async (messageType) => {
      const rows = patientRows();
      if (messageType === 'ORU^R01')
        rows.push(
          row('order', 'OBR.3'),
          row('service', 'OBR.4.1'),
          row('service', 'OBX.3.1'),
          row('value', 'OBX.5', 'NUMBER'),
        );
      if (messageType === 'ORM^O01') rows.push(row('order', 'ORC.2'), row('service', 'OBR.4.1'));
      const mapped = await executeScript(
        compileFieldMapping({
          version: 2,
          rows,
          hl7: header(messageType),
        }),
        { msg: patient },
      );
      const wire = String(await convertPayload(mapped, 'HL7V2'));
      const parsed = hl7ToJson(wire);
      expect(Object.keys(parsed)).toEqual(
        hl7Templates.find((item) => item.messageType === messageType)!.segments,
      );
      expect(parsed.MSH['9']).toEqual({
        '1': messageType.split('^')[0],
        '2': messageType.split('^')[1],
        '3': messageType.startsWith('ADT^') ? 'ADT_A01' : messageType.replace('^', '_'),
      });
      expect(parsed.MSH['7']).toBe('20261018220000');
      expect(parsed.MSH['10']).toBe('SYNTHETIC-MAPPING-001');
      expect(parsed.PID['7']).toBe('20000229');
      expect(wire).not.toContain('undefined');
      if (messageType === 'ORM^O01') expect(parsed.ORC['2']).toEqual(parsed.OBR['2']);
    },
  );

  it('normalizes HL7 source aliases only for actual HL7 and retains repeated identifiers', async () => {
    const raw =
      'MSH|^~\\&|A|B|C|D|20261018220000||ADT^A04|SYNTHETIC-IN|T|2.5\r' +
      'PID|1||ID-A^^^TEST^MR~ID-B^^^TEST^PI||Synthetic^Patient||20000229|F\r';
    expect(
      await execute(
        [
          row('PID-3.0.1', 'primary'),
          row('PID.3.1.1', 'secondary'),
          row('PID-5.2', 'given'),
          row('PID-7', 'birth', 'DATE_FROM_HL7'),
        ],
        raw,
      ),
    ).toEqual({ primary: 'ID-A', secondary: 'ID-B', given: 'Patient', birth: '2000-02-29' });
  });

  it('generates actual runtime timestamp and unique control identifiers when omitted', async () => {
    const script = compileFieldMapping({
      version: 2,
      rows: patientRows(),
      hl7: defaultHl7Configuration(),
    });
    const first = (await executeScript(script, { msg: patient })) as {
      MSH: Record<string, string>;
    };
    const second = (await executeScript(script, { msg: patient })) as {
      MSH: Record<string, string>;
    };
    expect(validHl7Timestamp(first.MSH['7'])).toBe(true);
    expect(first.MSH['7']).toMatch(/^\d{14}\+0000$/);
    expect(first.MSH['10']).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.MSH['10']).not.toBe(second.MSH['10']);
  });

  it.each(['', '+0000', '-0000', '+0700', '-0330', '+1400', '-1200', '+0059'])(
    'preserves a configured timestamp with valid offset %s in both MSH and EVN',
    async (offset) => {
      const timestamp = '20261018220000' + offset;
      expect(validHl7Timestamp(timestamp)).toBe(true);
      const result = (await executeScript(
        compileFieldMapping({
          version: 2,
          rows: patientRows(),
          hl7: { ...header(), messageDateTime: timestamp },
        }),
        { msg: patient },
      )) as { MSH: Record<string, string>; EVN: Record<string, string> };
      const wire = String(await convertPayload(result, 'HL7V2'));
      expect(result.MSH['7']).toBe(timestamp);
      expect(result.EVN['2']).toBe(timestamp);
      expect(hl7ToJson(wire).MSH).toMatchObject({ '7': timestamp });
    },
  );

  it.each(['+1401', '+1500', '-1460', '+0760', '+9999', '+070', '+07000', 'Z', '+-0700'])(
    'rejects invalid timestamp offset %s in configuration and runtime mapping',
    async (offset) => {
      const timestamp = '20261018220000' + offset;
      expect(validHl7Timestamp(timestamp)).toBe(false);
      expect(() =>
        compileFieldMapping({
          version: 2,
          rows: patientRows(),
          hl7: { ...header(), messageDateTime: timestamp },
        }),
      ).toThrow('offset');
      await expect(
        executeScript(
          compileFieldMapping({
            version: 2,
            rows: [...patientRows(), row('timestamp', 'MSH.7')],
            hl7: header(),
          }),
          { msg: { ...patient, timestamp } },
        ),
      ).rejects.toMatchObject({
        code: 'HL7_PROFILE_DATE',
      });
    },
  );

  it.each([
    ['birth', '2023-02-29', 'FIELD_MAPPING_CONVERSION'],
    ['sex', 'SYNTHETIC-INVALID-CODE', 'HL7_PROFILE_CODE'],
  ])('rejects invalid %s with a useful safe field diagnosis', async (field, value, code) => {
    await expect(
      executeScript(
        compileFieldMapping({
          version: 2,
          rows: patientRows(),
          hl7: header(),
        }),
        { msg: { ...patient, [field]: value } },
      ),
    ).rejects.toMatchObject({ code });
  });

  it('requires profile fields even when mappings mark them optional', async () => {
    await expect(
      executeScript(
        compileFieldMapping({
          version: 2,
          rows: [row('id', 'PID.3.1')],
          hl7: header(),
        }),
        { msg: patient },
      ),
    ).rejects.toMatchObject({
      code: 'HL7_PROFILE_REQUIRED',
      message: 'PID-5 (Patient name) is required by the selected template.',
    });
  });

  it('rejects unsupported templates, reserved headers and unsafe repetition settings', () => {
    for (const target of ['MSH.9.1', 'ZXX.3', 'PID.99', 'PID[0].3'])
      expect(() =>
        compileFieldMapping({
          version: 2,
          rows: [row('id', target)],
          hl7: header(),
        }),
      ).toThrow();
    expect(() =>
      compileFieldMapping({
        version: 2,
        rows: patientRows(),
        hl7: { ...header(), messageType: 'ADT^A08' },
      }),
    ).toThrow('supported');
    for (const targets of [
      ['OBX.3', 'OBX[0].5'],
      ['OBX[1].3', 'OBX[1].5'],
    ])
      expect(() =>
        compileFieldMapping({
          version: 2,
          rows: targets.map((target) => row('value', target)),
          hl7: header('ORU^R01'),
        }),
      ).toThrow(/indexes/);
  });

  it('offers template metadata without pretending every hospital uses the same profile', () => {
    expect(hl7Templates).toHaveLength(4);
    expect(hl7TargetFields('ADT^A04').some((field) => field.segment === 'OBX')).toBe(false);
    expect(hl7TargetFields('ORU^R01').some((field) => field.path === 'OBX.5')).toBe(true);
    expect(describeHl7Field('PID-5.2')).toBe('Given name');
    expect(describeHl7Field('MSH.9.3')).toBe('Message structure');
    expect(validCalendarDate('20000229')).toBe(true);
    expect(validCalendarDate('19000229')).toBe(false);
    expect(validHl7Timestamp('20261018240000')).toBe(false);
    expect(() =>
      validateFieldMapping({
        version: 2,
        rows: patientRows(),
        hl7: { ...header(), messageDateTime: '20260230220000' },
      }),
    ).toThrow('date/time');
  });
});
