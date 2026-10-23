import { describe, expect, it } from 'vitest';
import {
  readDestinationFilter,
  readSourceFilter,
  writeDestinationFilter,
  writeSourceFilter,
} from '../src/utils/sourceFilter.js';
import { compileSimpleCondition } from '../src/utils/simpleCondition.js';
import { compileFieldMapping } from '../src/utils/fieldMapping.js';
import { channelSchema, destinationSchema } from '../src/utils/validator.js';
import { executeScript } from '../src/services/script.services.js';
const condition = compileSimpleCondition({
  version: 1,
  field: 'department',
  operator: 'eq',
  value: 'LAB',
});
const destination = {
  name: 'Synthetic receiver',
  type: 'REST',
  endpoint: 'http://localhost:9100',
  outboundDataType: 'JSON',
};
describe('Destination filter persisted compatibility without a second enable flag', () => {
  it('OFF retains each exact condition/script and bypasses the sandbox without evaluating it', async () => {
    for (const rule of [
      condition,
      'return true;',
      'return false;',
      'true',
      'false',
      'throw new Error("SYNTHETIC-DONT-EVALUATE");',
    ]) {
      const saved = destinationSchema.parse({
        ...destination,
        filterScript: writeDestinationFilter(rule, false),
      });
      expect(readDestinationFilter(saved.filterScript)).toEqual({ enabled: false, rule });
      expect(writeDestinationFilter(readDestinationFilter(saved.filterScript).rule, true)).toBe(
        rule,
      );
      await expect(
        executeScript(saved.filterScript, { msg: { department: 'RAD' } }, 'true'),
      ).resolves.toBe(true);
    }
  });
  it('preserves source behavior and older source-wrapper destination API configurations', () => {
    const old = writeSourceFilter(condition, false);
    expect(readSourceFilter(old)).toEqual({ enabled: false, rule: condition });
    expect(readDestinationFilter(old)).toEqual({ enabled: false, rule: condition });
    expect(destinationSchema.parse({ ...destination, filterScript: old }).filterScript).toBe(old);
    expect(
      channelSchema.safeParse({
        name: 'Synthetic',
        source: { type: 'HTTP' },
        destinations: [],
        filterScript: writeDestinationFilter(condition, false),
      }).success,
    ).toBe(false);
    expect(readDestinationFilter('return false;')).toEqual({
      enabled: true,
      rule: 'return false;',
    });
    expect(readDestinationFilter('')).toEqual({ enabled: false, rule: '' });
  });
  it('refuses malformed/nested/oversized wrapper and corrupt generated rules rather than unconditional delivery', async () => {
    for (const filterScript of [
      '/* MIRTH_DESTINATION_FILTER_DISABLED_V1:invalid',
      condition + '\nreturn true;',
      writeDestinationFilter(writeSourceFilter(condition, false), false),
    ]) {
      expect(destinationSchema.safeParse({ ...destination, filterScript }).success).toBe(false);
      await expect(executeScript(filterScript, { msg: {} }, 'true')).rejects.toMatchObject({
        code: 'FILTER_CONFIG_INVALID',
      });
    }
    expect(() => writeDestinationFilter('x'.repeat(65536), false)).toThrow('storage limit');
  });
  it('keeps legacy boolean/custom behavior and intentional saved empty comparisons intact', async () => {
    for (const filterScript of [
      'return true;',
      'return false;',
      'true',
      'false',
      'return msg.department === "LAB";',
    ])
      expect(destinationSchema.parse({ ...destination, filterScript }).filterScript).toBe(
        filterScript,
      );
    const empty = compileSimpleCondition({
      version: 1,
      field: 'department',
      operator: 'eq',
      value: '',
    });
    expect(destinationSchema.parse({ ...destination, filterScript: empty }).filterScript).toBe(
      empty,
    );
    await expect(executeScript(empty, { msg: { department: '' } }, 'true')).resolves.toBe(true);
  });
});
describe('Destination mappings and legacy custom scripts share the existing sandbox', () => {
  it('keeps visual mappings intact and recognizes edited generated scripts as custom without breaking source or destination legacy behavior', async () => {
    const script = compileFieldMapping({
      version: 1,
      rows: [{ source: 'patient_id', target: 'patientCode', required: true }],
    });
    expect(
      destinationSchema.parse({ ...destination, processingScript: script }).processingScript,
    ).toBe(script);
    // Advanced editing historically retains the metadata comment; it is a custom script now.
    const custom = script + '\nreturn msg;';
    for (const key of ['processingScript', 'templateScript'])
      expect(
        destinationSchema.parse({ ...destination, [key]: custom })[
          key as 'processingScript' | 'templateScript'
        ],
      ).toBe(custom);
    await expect(executeScript(custom, { msg: { patient_id: 'SYNTHETIC' } })).resolves.toEqual({
      patientCode: 'SYNTHETIC',
    });
  });
});
