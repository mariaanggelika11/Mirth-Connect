import { describe, expect, it } from 'vitest';
import {
  compileSimpleCondition,
  readSimpleCondition,
  validateSimpleCondition,
  type SimpleConditionConfig,
} from '../src/utils/simpleCondition.js';
import { executeScript } from '../src/services/script.services.js';
import { compileFieldMapping } from '../src/utils/fieldMapping.js';
import { runConfiguration } from '../src/services/dryRun.services.js';
import { channelSchema } from '../src/utils/validator.js';
import { sample } from './fixtures.js';

const condition = (
  field = 'message_type',
  operator: SimpleConditionConfig['operator'] = 'eq',
  value = 'ADT',
): SimpleConditionConfig => ({ version: 1, field, operator, value });
const matches = (config: SimpleConditionConfig, payload: unknown) =>
  executeScript(compileSimpleCondition(config), { msg: payload }, 'true');

describe('Simple filter configuration compatibility and safety', () => {
  it('round trips only intact generated conditions and leaves legacy scripts custom', () => {
    const config = condition();
    const script = compileSimpleCondition(config);
    expect(readSimpleCondition(script)).toEqual(config);
    for (const legacy of [
      '',
      'false',
      'true',
      'return false;',
      'return msg.message_type === "ADT";',
      script + '\nreturn false;',
      script.replace('var conditionInput = msg;', 'var conditionInput = {};'),
      '/* MIRTH_SIMPLE_CONDITION_V1:%invalid */\n',
      '/* MIRTH_SIMPLE_CONDITION_V1:',
      'x'.repeat(65537),
    ])
      expect(readSimpleCondition(legacy)).toBeNull();
  });

  it('normalizes paths and removes irrelevant values from presence operators', () => {
    expect(validateSimpleCondition(condition(' message_type '))).toEqual(condition());
    expect(validateSimpleCondition(condition('patient.name', 'exists'))).toEqual({
      version: 1,
      field: 'patient.name',
      operator: 'exists',
    });
    expect(readSimpleCondition(compileSimpleCondition(condition('name', 'notExists')))).toEqual({
      version: 1,
      field: 'name',
      operator: 'notExists',
    });
  });

  it('rejects prototype access, executable paths, excess size and unknown settings', () => {
    for (const field of [
      '',
      'a..b',
      'patient[0]',
      'patient()',
      '__proto__',
      'patient.constructor.name',
      'patient.prototype.name',
      'a.'.repeat(12) + 'z',
      'x'.repeat(257),
    ])
      expect(() => compileSimpleCondition(condition(field))).toThrow('valid filter field');
    for (const config of [
      null,
      [],
      { ...condition(), version: 2 },
      { ...condition(), operator: 'eval' },
      { ...condition(), field: null },
      { ...condition(), extra: 'SYNTHETIC-SECRET' },
      { ...condition(), value: { nested: 'value' } },
      { ...condition(), value: 'x'.repeat(1025) },
    ])
      expect(() => validateSimpleCondition(config)).toThrow();
    for (const value of ['', ' ', 'NaN', 'Infinity', '10;return true;'])
      expect(() => compileSimpleCondition(condition('age', 'gte', value))).toThrow('finite number');
  });

  it('treats quotes and script fragments in values strictly as string data', async () => {
    const value = '\"; throw new Error("SYNTHETIC-SECRET"); //';
    await expect(
      matches(condition('message_type', 'eq', value), { message_type: value }),
    ).resolves.toBe(true);
    await expect(
      matches(condition('message_type', 'eq', value), { message_type: 'ADT' }),
    ).resolves.toBe(false);
  });
});

describe('Simple conditions use the existing isolated filter pipeline', () => {
  it('supports text operators, scalar comparisons and safe nested own-property traversal', async () => {
    for (const [config, payload, expected] of [
      [condition(), { message_type: 'ADT' }, true],
      [condition(), { message_type: 'ORM' }, false],
      [condition('message_type', 'neq', 'ADT'), { message_type: 'ORM' }, true],
      [condition('message_type', 'neq', 'ADT'), {}, false],
      [condition('name', 'contains', 'Aminah'), { name: 'Siti Aminah' }, true],
      [condition('name', 'startsWith', 'Siti'), { name: 'Siti Aminah' }, true],
      [condition('name', 'startsWith', 'Aminah'), { name: 'Siti Aminah' }, false],
      [condition('patient.0.id', 'eq', '0'), { patient: [{ id: 0 }] }, true],
      [condition('active', 'eq', 'false'), { active: false }, true],
      [condition('name', 'eq', ''), { name: '' }, true],
      [condition('name', 'neq', 'ADT'), { name: null }, false],
      [condition('name', 'neq', 'ADT'), { name: { nested: 'value' } }, false],
    ] as [SimpleConditionConfig, unknown, boolean][])
      await expect(matches(config, payload)).resolves.toBe(expected);
  });

  it('distinguishes absence from existing null or empty fields', async () => {
    for (const [payload, exists] of [
      [{}, false],
      [{ patient: {} }, false],
      [{ patient: null }, false],
      [{ patient: { id: null } }, true],
      [{ patient: { id: '' } }, true],
      [{ patient: { id: false } }, true],
    ] as [unknown, boolean][]) {
      await expect(matches(condition('patient.id', 'exists'), payload)).resolves.toBe(exists);
      await expect(matches(condition('patient.id', 'notExists'), payload)).resolves.toBe(!exists);
    }
    await expect(
      matches(condition('inherited', 'exists'), Object.create({ inherited: 'value' })),
    ).resolves.toBe(false);
  });

  it('compares finite numbers and numeric strings without null/boolean/empty coercion', async () => {
    for (const [operator, value, expected] of [
      ['gt', 11, true],
      ['gt', 10, false],
      ['gte', '10', true],
      ['lt', '9.5', true],
      ['lte', 10, true],
      ['lte', 11, false],
      ['gte', true, false],
      ['lte', null, false],
      ['lte', '', false],
      ['lte', ' ', false],
      ['lte', 'not a number', false],
    ] as [SimpleConditionConfig['operator'], unknown, boolean][])
      await expect(matches(condition('age', operator, '10'), { age: value })).resolves.toBe(
        expected,
      );
  });

  it('accepts JSON and HL7 structured input without changing legacy filter contexts', async () => {
    await expect(matches(condition(), '{"message_type":"ADT"}')).resolves.toBe(true);
    await expect(matches(condition('MSH.10', 'eq', 'ID123'), sample)).resolves.toBe(true);
    await expect(matches(condition(), 'not structured data')).rejects.toMatchObject({
      code: 'FILTER_INPUT_INVALID',
    });
    await expect(executeScript('return false;', { msg: {} }, 'true')).resolves.toBe(false);
  });

  it('normalizes XML only for intact generated filters and rejects unsafe declarations', async () => {
    const xml = '<Patient><Department>LAB</Department></Patient>';
    await expect(matches(condition('Patient.Department', 'eq', 'LAB'), xml)).resolves.toBe(true);
    await expect(
      executeScript('return typeof msg === "string";', { msg: xml }, 'true'),
    ).resolves.toBe(true);
    await expect(
      matches(condition('Patient.Department', 'exists'), '<Patient>'),
    ).rejects.toMatchObject({ code: 'FILTER_INPUT_INVALID' });
    await expect(
      matches(condition('Patient.Department', 'exists'), '<!DOCTYPE Patient><Patient/>'),
    ).rejects.toMatchObject({ code: 'XML_ENTITIES_DENIED' });
  });

  it('keeps syntax validation separate from source selection and destination routing', async () => {
    const configuration = channelSchema.parse({
      name: 'Synthetic condition pipeline',
      source: { type: 'HTTP', inboundDataType: 'JSON' },
      validationProfile: { basicSyntax: true },
      filterScript: compileSimpleCondition(condition()),
      processingScript: compileFieldMapping({
        version: 1,
        rootElement: 'Patient',
        rows: [{ source: 'patient_id', target: 'PatientID', required: true }],
      }),
      destinations: [
        {
          name: 'Patient receiver',
          type: 'REST',
          endpoint: 'http://localhost/synthetic',
          outboundDataType: 'XML',
          filterScript: compileSimpleCondition(condition('Patient.PatientID', 'eq', 'RM-000123')),
        },
      ],
    });
    const filtered = await runConfiguration(configuration, { message_type: 'ORM' });
    expect(filtered).toMatchObject({
      success: true,
      accepted: false,
      networkDelivery: 'NOT_SENT',
      source: { validation: 'PASSED', filter: 'FILTERED', transformation: 'SKIPPED' },
      results: [{ routed: false }],
    });
    const accepted = await runConfiguration(configuration, {
      message_type: 'ADT',
      patient_id: 'RM-000123',
    });
    expect(accepted).toMatchObject({
      accepted: true,
      source: { validation: 'PASSED', filter: 'ACCEPTED', transformation: 'TRANSFORMED' },
      results: [
        { routed: true, finalPayload: '<Patient>\n  <PatientID>RM-000123</PatientID>\n</Patient>' },
      ],
    });
    const missingRequired = await runConfiguration(configuration, { message_type: 'ADT' });
    expect(missingRequired).toMatchObject({
      success: false,
      source: { validation: 'PASSED', filter: 'ACCEPTED', transformation: 'ERROR' },
      results: [],
    });
    expect(JSON.stringify(missingRequired.warnings)).not.toContain('RM-000123');
  });
});

describe('Source condition empty-value semantics', () => {
  it('handles missing, null, empty, scalar and structured fields consistently', async () => {
    for (const [payload, empty, notEmpty] of [
      [{}, true, false],
      [{ field: null }, true, false],
      [{ field: '' }, true, false],
      [{ field: 0 }, false, true],
      [{ field: false }, false, true],
      [{ field: ' ' }, false, true],
      [{ field: [] }, false, false],
      [{ field: {} }, false, false],
    ] as [unknown, boolean, boolean][]) {
      await expect(matches(condition('field', 'isEmpty'), payload)).resolves.toBe(empty);
      await expect(matches(condition('field', 'isNotEmpty'), payload)).resolves.toBe(notEmpty);
    }
  });
});
