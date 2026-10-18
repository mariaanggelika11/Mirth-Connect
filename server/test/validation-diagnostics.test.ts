import { describe, expect, it } from 'vitest';
import {
  messageErrorCode,
  persistValidationFailure,
  safeValidationResults,
  storedValidationFailure,
} from '../src/utils/validationDiagnostics.js';
const result = {
  field: 'patient.id',
  type: 'text',
  required: true,
  status: 'FAILED',
  code: 'REQUIRED',
  message: 'SYNTHETIC-PHI-PATIENT-NAME',
  value: 'SYNTHETIC-PHI-VALUE',
};
describe('Validation diagnostics never carry payload values or arbitrary exception text', () => {
  it('rebuilds bounded field outcomes and stores only safe failure metadata', () => {
    const saved = persistValidationFailure('FIELD_VALIDATION_FAILED', [
      result,
      { ...result, field: 'age', type: 'number', status: 'PASSED' },
    ]);
    expect(saved).not.toContain('SYNTHETIC-PHI');
    expect(messageErrorCode(saved)).toBe('FIELD_VALIDATION_FAILED');
    expect(storedValidationFailure(saved)).toEqual({
      code: 'FIELD_VALIDATION_FAILED',
      results: [
        {
          field: 'patient.id',
          type: 'text',
          required: true,
          status: 'FAILED',
          code: 'REQUIRED',
          message: 'Required value is missing.',
        },
      ],
    });
  });
  it('ignores malformed/unbounded/unsafe diagnostics and preserves legacy code behavior', () => {
    for (const value of [null, [], { x: 'secret' }, Array(51).fill(result)])
      expect(safeValidationResults(value)).toEqual([]);
    for (const patch of [
      { field: '__proto__.name' },
      { field: 'patient.constructor' },
      { type: 'script' },
      { status: 'unknown' },
      { required: 'true' },
      { code: 'SYNTHETIC-PHI' },
    ])
      expect(safeValidationResults([{ ...result, ...patch }])).toEqual([]);
    for (const value of [
      'VALIDATION_DETAILS_V1:{',
      'VALIDATION_DETAILS_V1:' + JSON.stringify({ code: 'CUSTOM', results: [result] }),
      'VALIDATION_DETAILS_V1:' +
        JSON.stringify({
          code: 'FIELD_VALIDATION_FAILED',
          results: [{ ...result, field: '__proto__' }],
        }),
      'VALIDATION_DETAILS_V1:' + 'x'.repeat(50001),
    ])
      expect(storedValidationFailure(value)).toBeUndefined();
    expect(persistValidationFailure('SCRIPT_TIMEOUT', [result])).toBe('SCRIPT_TIMEOUT');
    expect(messageErrorCode('JSON_INVALID')).toBe('JSON_INVALID');
    expect(messageErrorCode(undefined)).toBeUndefined();
    expect(safeValidationResults([{ ...result, status: 'SKIPPED' }])).toMatchObject([
      { message: 'Optional field is not present.' },
    ]);
  });
});

describe('Nested validation scripts retain revision sanitization', () => {
  it('does not expose inactive custom or legacy script contents in revision review/diff', async () => {
    const { safeRevision } = await import('../src/services/revision.services.js');
    const { channelSchema } = await import('../src/utils/validator.js');
    const original = channelSchema.parse({
      name: 'Synthetic',
      source: { type: 'HTTP', inboundDataType: 'JSON' },
      destinations: [],
      validationProfile: {
        version: 1,
        mode: 'NONE',
        fieldRules: [],
        custom: { script: 'return "SYNTHETIC-CONFIG-SECRET";' },
        legacy: { script: 'return "SYNTHETIC-LEGACY-SECRET";' },
      },
    });
    const safe = safeRevision(original);
    expect(JSON.stringify(safe)).not.toContain('SYNTHETIC-CONFIG-SECRET');
    expect(JSON.stringify(safe)).not.toContain('SYNTHETIC-LEGACY-SECRET');
    expect(safe.validationProfile).toMatchObject({
      custom: { script: '[CONFIGURED]' },
      legacy: { script: '[CONFIGURED]' },
    });
    expect(original.validationProfile).toMatchObject({
      custom: { script: 'return "SYNTHETIC-CONFIG-SECRET";' },
    });
  });
});
