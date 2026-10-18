import { describe, expect, it } from 'vitest';
import {
  FieldValidationError,
  validatePayload,
  validateProfileConfiguration,
} from '../src/services/profileValidation.services.js';
import {
  fieldRuleErrors,
  readValidationSettings,
  type FieldRule,
  type ValidationSettings,
} from '../src/utils/validationRules.js';
import { channelSchema } from '../src/utils/validator.js';
import { safeRevision } from '../src/services/revision.services.js';

const rule = (patch: Partial<FieldRule> = {}): FieldRule => ({
  field: 'patient_id',
  type: 'text',
  required: true,
  ...patch,
});
const fields = (...rules: FieldRule[]): ValidationSettings => ({
  version: 1,
  mode: 'FIELDS',
  fieldRules: rules,
  custom: {},
});
async function failures(payload: unknown, profile: ValidationSettings) {
  try {
    await validatePayload(payload, 'JSON', profile);
  } catch (error) {
    expect(error).toBeInstanceOf(FieldValidationError);
    const rejection = error as FieldValidationError;
    expect(rejection.code).toBe('FIELD_VALIDATION_FAILED');
    expect(rejection.status).toBe(422);
    return rejection.results;
  }
  throw new Error('Expected field validation to reject the synthetic message');
}

describe('Explicit field rules', () => {
  it('evaluates all rules, preserves order and does not mutate or expose values', async () => {
    const profile = fields(
      rule(),
      rule({ field: 'name', minLength: 2 }),
      rule({ field: 'gender', allowedValues: ['M', 'F'] }),
      rule({ field: 'date_of_birth', type: 'date' }),
    );
    validateProfileConfiguration(profile, 'JSON');
    const payload = {
      patient_id: 'SYNTHETIC-ID',
      name: 'Synthetic Patient',
      gender: 'F',
      date_of_birth: '2000-02-29',
      extra: 'Unrestricted extra field',
    };
    const before = structuredClone(payload);
    const result = await validatePayload(payload, 'JSON', profile);
    expect(result?.map((entry) => [entry.field, entry.status])).toEqual(
      profile.fieldRules.map((entry) => [entry.field, 'PASSED']),
    );
    expect(payload).toEqual(before);
    expect(JSON.stringify(result)).not.toContain('Synthetic Patient');
    const rejected = await failures(
      { patient_id: '', name: 'x', gender: 'SYNTHETIC-PRIVATE-VALUE', date_of_birth: '2026-02-30' },
      profile,
    );
    expect(rejected.map((entry) => entry.code)).toEqual([
      'REQUIRED',
      'MIN_LENGTH',
      'ALLOWED_VALUES',
      'DATE',
    ]);
    expect(JSON.stringify(rejected)).not.toContain('SYNTHETIC-PRIVATE-VALUE');
    expect(Object.isFrozen(rejected)).toBe(true);
    expect(Object.isFrozen(rejected[0])).toBe(true);
  });
  it('requires missing, null and whitespace-only values without rejecting 0 or false', async () => {
    for (const payload of [{}, { patient_id: null }, { patient_id: '' }, { patient_id: ' \n ' }])
      expect((await failures(payload, fields(rule())))[0].code).toBe('REQUIRED');
    const result = await validatePayload(
      { count: 0, active: false },
      'JSON',
      fields(rule({ field: 'count', type: 'number' }), rule({ field: 'active', type: 'boolean' })),
    );
    expect(result?.every((entry) => entry.status === 'PASSED')).toBe(true);
  });
  it('skips only absent optional values; null and wrong types still fail', async () => {
    const profile = fields(rule({ required: false }));
    expect(await validatePayload({}, 'JSON', profile)).toMatchObject([{ status: 'SKIPPED' }]);
    expect(await validatePayload({ patient_id: '' }, 'JSON', profile)).toMatchObject([
      { status: 'PASSED' },
    ]);
    for (const value of [null, 12, true, {}, []])
      expect((await failures({ patient_id: value }, profile))[0].code).toBe('TYPE');
  });
  it('does not coerce text, number or boolean values', async () => {
    const profile = fields(
      rule({ field: 'count', type: 'number' }),
      rule({ field: 'active', type: 'boolean' }),
      rule({ field: 'id', type: 'text' }),
    );
    expect(
      (await failures({ count: '0', active: 'false', id: 7 }, profile)).map((entry) => entry.code),
    ).toEqual(['TYPE', 'TYPE', 'TYPE']);
  });
  it('uses own nested properties and numeric array indexes for object or array roots', async () => {
    const object = fields(rule({ field: 'patients.0.patient_id' }));
    expect(
      await validatePayload({ patients: [{ patient_id: 'SYNTHETIC' }] }, 'JSON', object),
    ).toMatchObject([{ status: 'PASSED' }]);
    expect(
      await validatePayload(
        [{ patient_id: 'SYNTHETIC' }],
        'JSON',
        fields(rule({ field: '0.patient_id' })),
      ),
    ).toMatchObject([{ status: 'PASSED' }]);
    expect(
      (await failures(Object.create({ patient_id: 'INHERITED_PRIVATE_ID' }), fields(rule())))[0]
        .code,
    ).toBe('REQUIRED');
    for (const payload of [null, false, 0, 'scalar'])
      expect((await failures(payload, fields(rule({ required: false }))))[0].code).toBe('TYPE');
  });
  it('compares allowed values case-sensitively without trimming valid input', async () => {
    const profile = fields(rule({ allowedValues: ['M', 'F'] }));
    expect(await validatePayload({ patient_id: 'M' }, 'JSON', profile)).toMatchObject([
      { status: 'PASSED' },
    ]);
    for (const value of ['m', ' M', 'M '])
      expect((await failures({ patient_id: value }, profile))[0].code).toBe('ALLOWED_VALUES');
    const exactWhitespace = fields(rule({ required: false, allowedValues: [' ', ' M '] }));
    for (const patient_id of [' ', ' M '])
      expect(await validatePayload({ patient_id }, 'JSON', exactWhitespace)).toMatchObject([
        { status: 'PASSED' },
      ]);
    for (const patient_id of ['', '  ', 'M'])
      expect((await failures({ patient_id }, exactWhitespace))[0].code).toBe('ALLOWED_VALUES');
  });
  it('checks inclusive length and numeric boundaries', async () => {
    const text = fields(rule({ minLength: 2, maxLength: 3 }));
    for (const patient_id of ['ab', 'abc'])
      expect(await validatePayload({ patient_id }, 'JSON', text)).toMatchObject([
        { status: 'PASSED' },
      ]);
    expect((await failures({ patient_id: 'a' }, text))[0].code).toBe('MIN_LENGTH');
    expect((await failures({ patient_id: 'abcd' }, text))[0].code).toBe('MAX_LENGTH');
    const number = fields(rule({ type: 'number', minimum: 0, maximum: 100 }));
    for (const patient_id of [0, 100])
      expect(await validatePayload({ patient_id }, 'JSON', number)).toMatchObject([
        { status: 'PASSED' },
      ]);
    expect((await failures({ patient_id: -1 }, number))[0].code).toBe('MINIMUM');
    expect((await failures({ patient_id: 101 }, number))[0].code).toBe('MAXIMUM');
  });
  it('validates real calendar dates including century leap-year rules', async () => {
    const profile = fields(rule({ type: 'date' }));
    for (const patient_id of ['0001-01-01', '2000-02-29', '2024-02-29', '2026-10-18'])
      expect(await validatePayload({ patient_id }, 'JSON', profile)).toMatchObject([
        { status: 'PASSED' },
      ]);
    for (const patient_id of [
      '0000-01-01',
      '1900-02-29',
      '2026-02-29',
      '2026-04-31',
      '2026-13-01',
      '2026-00-01',
      '2026-01-00',
      '2026-1-1',
      '2026-10-18T00:00:00Z',
    ])
      expect((await failures({ patient_id }, profile))[0].code).toBe('DATE');
    expect((await failures({ patient_id: 20261018 }, profile))[0].code).toBe('TYPE');
  });
  it('rejects invalid JSON values before evaluating rules', async () => {
    for (const patient_id of [NaN, Infinity, 1n])
      await expect(validatePayload({ patient_id }, 'JSON', fields(rule()))).rejects.toMatchObject({
        code: 'JSON_INVALID',
      });
  });
});

describe('Validation configuration and retained settings', () => {
  it('derives existing choices without changing or aliasing their configuration', () => {
    expect(readValidationSettings({}).mode).toBe('NONE');
    for (const original of [{ basicSyntax: true }, { jsonSchema: { type: 'object' } }]) {
      const settings = readValidationSettings(original);
      expect(settings.mode).toBe('LEGACY');
      expect(settings.legacy).toEqual(original);
      expect(settings.legacy).not.toBe(original);
    }
    const original = {
      jsonSchema: { type: 'object', required: ['patient_id'] },
      script: 'return true;',
    };
    expect(readValidationSettings(original)).toMatchObject({ mode: 'CUSTOM', custom: original });
  });
  it('retains inactive rules and custom schema without compiling or executing them', async () => {
    const profile: ValidationSettings = {
      version: 1,
      mode: 'NONE',
      fieldRules: [rule({ field: '' })],
      custom: {
        jsonSchema: { $ref: 'https://example.invalid/never-fetch' },
        script: 'while(true){}',
      },
      legacy: { script: 'while(true){}' },
    };
    const parsed = channelSchema.parse({
      name: 'Synthetic',
      source: { type: 'HTTP', inboundDataType: 'JSON' },
      destinations: [],
      validationProfile: profile,
    });
    expect(parsed.validationProfile).toEqual(profile);
    validateProfileConfiguration(profile, 'JSON');
    await expect(validatePayload({}, 'JSON', profile)).resolves.toBeUndefined();
    const activeFields = { ...profile, mode: 'FIELDS' as const, fieldRules: [rule()] };
    validateProfileConfiguration(activeFields, 'JSON');
    expect(await validatePayload({ patient_id: 'SYNTHETIC' }, 'JSON', activeFields)).toMatchObject([
      { status: 'PASSED' },
    ]);
    const activeCustom = {
      ...profile,
      mode: 'CUSTOM' as const,
      custom: { jsonSchema: { type: 'object' } },
    };
    validateProfileConfiguration(activeCustom, 'JSON');
    await expect(validatePayload({}, 'JSON', activeCustom)).resolves.toBeUndefined();
  });
  it('allows explicitly empty JSON Schema and retains additional-field behavior', async () => {
    const profile: ValidationSettings = {
      ...fields(rule()),
      mode: 'CUSTOM',
      custom: { jsonSchema: {} },
    };
    validateProfileConfiguration(profile, 'JSON');
    await expect(validatePayload({ extra: 'SYNTHETIC' }, 'JSON', profile)).resolves.toBeUndefined();
  });
  it('rejects malformed inactive field structures while retaining incomplete editable rules', () => {
    const source = {
      name: 'Synthetic retained validation',
      source: { type: 'HTTP', inboundDataType: 'JSON' },
      destinations: [],
    };
    for (const patch of [
      { allowedValues: 'M' },
      { allowedValues: [123] },
      { allowedValues: ['M\nF'] },
      { allowedValues: Array(51).fill('M') },
      { minLength: '1' },
      { maximum: Infinity },
      { type: 'script' },
      { required: 'true' },
      { field: 'x'.repeat(257) },
      { unexpected: true },
    ])
      expect(
        channelSchema.safeParse({
          ...source,
          validationProfile: {
            ...fields(rule()),
            mode: 'NONE',
            fieldRules: [{ ...rule(), ...patch }],
          },
        }).success,
      ).toBe(false);
    const incomplete = {
      ...fields(rule()),
      mode: 'NONE',
      fieldRules: [rule({ field: '', minLength: -1.5, maxLength: -3, allowedValues: [] })],
    };
    expect(
      channelSchema.parse({ ...source, validationProfile: incomplete }).validationProfile,
    ).toEqual(incomplete);
  });
  it('rejects multiline field allowed values without changing legacy JSON Schema enum values', async () => {
    for (const value of ['M\nF', 'M\rF', 'M\r\nF']) {
      const profile = fields(rule({ allowedValues: [value] }));
      expect(fieldRuleErrors(profile.fieldRules)).toMatchObject([
        { index: 0, message: 'Allowed values must be single-line text without line breaks.' },
      ]);
      expect(() => validateProfileConfiguration(profile, 'JSON')).toThrowError(
        expect.objectContaining({ code: 'INVALID_FIELD_RULES' }),
      );
      const legacy = {
        jsonSchema: { type: 'object', properties: { patient_id: { enum: [value] } } },
      };
      validateProfileConfiguration(legacy, 'JSON');
      await expect(validatePayload({ patient_id: value }, 'JSON', legacy)).resolves.toBeUndefined();
    }
  });
  it('rejects empty custom profiles, bare schemas, typo settings and invalid versions', () => {
    for (const profile of [
      { type: 'object', required: ['patient_id'] },
      { jsonShema: { type: 'object' } },
      { ...fields(rule()), version: 2 },
      { ...fields(rule()), mode: 'CUSTOM', custom: {} },
      { ...fields(rule()), mode: 'CUSTOM', custom: { type: 'object', required: ['patient_id'] } },
      { ...fields(rule()), mode: 'CUSTOM', custom: { jsonSchema: {}, typo: true } },
    ])
      expect(() => validateProfileConfiguration(profile, 'JSON')).toThrowError(
        expect.objectContaining({ code: 'INVALID_VALIDATION_PROFILE' }),
      );
    expect(
      channelSchema.safeParse({
        name: 'Synthetic',
        source: { type: 'HTTP' },
        destinations: [],
        validationProfile: { type: 'object' },
      }).success,
    ).toBe(false);
  });
  it('rejects active fields and custom profiles for incompatible source formats', () => {
    for (const format of ['XML', 'HL7V2', 'TEXT'])
      expect(() => validateProfileConfiguration(fields(rule()), format)).toThrowError(
        expect.objectContaining({ code: 'VALIDATION_FORMAT_UNSUPPORTED' }),
      );
    expect(() =>
      validateProfileConfiguration(
        { ...fields(rule()), mode: 'CUSTOM', custom: { xml: { root: 'Patient' } } },
        'JSON',
      ),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_FORMAT_UNSUPPORTED' }));
    expect(() =>
      validateProfileConfiguration(
        { ...fields(rule()), mode: 'CUSTOM', custom: { jsonSchema: {} } },
        'XML',
      ),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_FORMAT_UNSUPPORTED' }));
  });
  it('preserves legacy behavior without executing inactive profile data', async () => {
    const profile: ValidationSettings = {
      ...fields(rule()),
      mode: 'LEGACY',
      legacy: { basicSyntax: true },
      custom: { script: 'while(true){}' },
    };
    validateProfileConfiguration(profile, 'JSON');
    await expect(validatePayload(null, 'JSON', profile)).resolves.toBeUndefined();
    await expect(
      validatePayload([], 'JSON', { ...profile, legacy: { jsonSchema: { type: 'object' } } }),
    ).rejects.toMatchObject({ code: 'PAYLOAD_SCHEMA_REJECTED' });
    await expect(
      validatePayload([], 'JSON', {
        ...profile,
        legacy: { basicSyntax: true, jsonSchema: { type: 'object' } },
      }),
    ).rejects.toMatchObject({ code: 'PAYLOAD_SCHEMA_REJECTED' });
  });
  it('masks custom and retained validation scripts in sanitized revisions', () => {
    const configuration = channelSchema.parse({
      name: 'Synthetic',
      source: { type: 'HTTP', inboundDataType: 'JSON' },
      destinations: [],
      validationProfile: {
        ...fields(rule()),
        mode: 'CUSTOM',
        custom: { script: 'return msg.SYNTHETIC_PRIVATE_VALUE;' },
        legacy: { script: 'return msg.OTHER_PRIVATE_VALUE;' },
      },
    });
    const safe = safeRevision(configuration);
    expect(safe.validationProfile).toMatchObject({
      custom: { script: '[CONFIGURED]' },
      legacy: { script: '[CONFIGURED]' },
    });
    expect(JSON.stringify(safe)).not.toContain('SYNTHETIC_PRIVATE_VALUE');
    expect(JSON.stringify(safe)).not.toContain('OTHER_PRIVATE_VALUE');
  });
  it('bounds rule count, paths, allowed values and numeric limits', () => {
    const invalid: unknown[] = [
      [],
      Array.from({ length: 51 }, (_, index) => rule({ field: `field${index}` })),
      [rule({ field: '__proto__.polluted' })],
      [rule({ field: 'patient.constructor.name' })],
      [rule({ field: 'patient.prototype.id' })],
      [rule({ field: 'patient..id' })],
      [rule({ field: 'patient[0].id' })],
      [rule({ field: 'a'.repeat(257) })],
      [rule({ field: Array(13).fill('a').join('.') })],
      [rule(), rule()],
      [rule({ allowedValues: [] })],
      [rule({ allowedValues: [''] })],
      [rule({ allowedValues: ['M\nF'] })],
      [rule({ allowedValues: ['M\rF'] })],
      [rule({ allowedValues: Array(51).fill('x') })],
      [rule({ allowedValues: ['x'.repeat(301)] })],
      [rule({ type: 'number', allowedValues: ['1'] })],
      [rule({ type: 'number', minLength: 1 })],
      [rule({ minimum: 1 })],
      [rule({ minLength: -1 })],
      [rule({ minLength: 1.1 })],
      [rule({ minLength: 5, maxLength: 2 })],
      [rule({ type: 'number', minimum: 5, maximum: 2 })],
      [rule({ type: 'number', minimum: Infinity })],
      [{ ...rule(), required: 'true' }],
      [{ ...rule(), unsupported: 'SYNTHETIC_PRIVATE_SETTING' }],
      [null],
    ];
    for (const fieldRules of invalid) {
      const errors = fieldRuleErrors(fieldRules);
      expect(errors.length).toBeGreaterThan(0);
      expect(JSON.stringify(errors)).not.toContain('SYNTHETIC_PRIVATE_SETTING');
      expect(() =>
        validateProfileConfiguration({ ...fields(rule()), fieldRules }, 'JSON'),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_FIELD_RULES' }));
    }
    expect(fieldRuleErrors([rule({ field: Array(12).fill('a').join('.') })])).toEqual([]);
    expect(
      fieldRuleErrors(Array.from({ length: 50 }, (_, index) => rule({ field: `field${index}` }))),
    ).toEqual([]);
  });
});
