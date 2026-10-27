import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import hl7 from '@ehr/hl7-v2';
import { generateHl7 } from '../src/utils/ehrHl7Generator.js';
import { hl7ToJson, jsonToHl7, parseSegments } from '../src/utils/hl7Converer.js';
import { convertPayload } from '../src/services/engine/conversion.js';
import { sample } from './fixtures.js';
import { maskPayload } from '../src/utils/masking.js';

const fixture = () =>
  JSON.parse(readFileSync(new URL('./fixtures/mdm-teleport.json', import.meta.url), 'utf8'));
const msh = () => ({
  '9': { '1': 'MDM', '2': 'T02' },
  '10': 'SYNTHETIC-ID',
  '11': 'T',
  '12': '2.3',
});
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

describe('@ehr/hl7-v2 compatibility adapter', () => {
  it('uses the actual package serializer and preserves canonical bytes without changing its global schema', () => {
    const generator = new hl7.Generator();
    const schema = JSON.stringify(generator.schema());
    const write = vi.spyOn(hl7.Generator.prototype, 'writeSegment');
    try {
      const input = hl7ToJson(sample);
      const original = structuredClone(input);
      expect(generateHl7(input)).toBe(sample);
      expect(write.mock.calls.map((call) => call[1])).toEqual(['MSH', 'PID', 'OBX', 'OBX']);
      expect(input).toEqual(original);
      // Each call replaces only its instance schema, never the package default.
      expect(JSON.stringify(new hl7.Generator().schema())).toBe(schema);
    } finally {
      write.mockRestore();
    }
  });
  it('normalizes XML-shaped MDM JSON, generates missing technical headers and keeps clinical values and image bytes', async () => {
    const input = fixture();
    const original = structuredClone(input);
    const raw = (await convertPayload(input, 'HL7V2')) as string;
    const parsed = parseSegments(raw);
    expect(parsed.segments.map((s) => s.name)).toEqual(['MSH', 'PID', 'PV1', 'TXA', 'OBX', 'NTE']);
    const [header, pid, pv1, txa, obx, nte] = parsed.segments;
    expect(raw.startsWith('MSH|^~\\&|')).toBe(true);
    expect(header.fields[9]).toBe('MDM^T02');
    expect(header.fields[12]).toBe('2.3');
    expect(header.fields[7]).toMatch(/^\d{14}\+0000$/);
    expect(header.fields[10]).toMatch(/^[a-f\d-]{36}$/);
    expect(pid.fields[1]).toBe(original.HL7Message.PID['PID.1']);
    expect(pid.fields[5]).toBe('Example^Synthetic');
    expect(pid.fields[7]).toBe('07/07/1997');
    expect(pv1.fields[19]).toBe('SYNTHETIC-VISIT');
    expect(txa.fields[12]).toBe('SYNTHETIC-DOCUMENT');
    expect(digest(obx.fields[5].split('^')[4])).toBe(
      digest(original.HL7Message.OBX['OBX.5']['OBX.5.5']),
    );
    expect(nte.fields[3]).toBe('Synthetic image fixture only.');
    expect(raw).not.toMatch(/\n|\{\{CR13\}\}|&amp;/);
    expect(raw.endsWith('\r')).toBe(true);
    expect(input).toEqual(original);
    expect(parseSegments(generateHl7(input)).segments[0].fields[10]).not.toBe(header.fields[10]);
  });
  it('preserves an 86KB encoded image byte-for-byte', () => {
    const input = fixture();
    const image = Buffer.alloc(64929, 42).toString('base64');
    input.HL7Message.OBX['OBX.5']['OBX.5.5'] = image;
    const raw = generateHl7(input);
    const obx = parseSegments(raw).segments.find((s) => s.name === 'OBX')!;
    expect(image.length).toBe(86572);
    expect(obx.fields[5].split('^')[4]).toBe(image);
  });
  it('keeps supplied timestamps/control IDs and supports prefixed keys without a wrapper', () => {
    const input = fixture().HL7Message;
    input.MSH['MSH.7'] = { 'MSH.7.1': '20261027120000+0700' };
    input.MSH['MSH.10'] = 'SYNTHETIC-SUPPLIED-ID';
    const header = parseSegments(generateHl7(input)).segments[0];
    expect(header.fields[7]).toBe('20261027120000+0700');
    expect(header.fields[10]).toBe('SYNTHETIC-SUPPLIED-ID');
  });
  it('supports repeated segments, repetitions, subcomponents and unequal segment lengths losslessly', () => {
    const input = {
      MSH: msh(),
      Z99: [
        { '1': 0, '2': false },
        { '1': { '1': { '1': 'A', '2': 'B' }, '2': 'C' }, '3': ['D', 'E'] },
      ],
      OBX: { '5': ['A\\F\\B', { '1': 'C', '2': 'D' }] },
    };
    expect(generateHl7(input)).toBe(jsonToHl7(input));
    expect(generateHl7({ MSH: msh(), PID: { '1': 'second' } })).not.toContain('Z99');
  });
  it('retains custom delimiters, already encoded values, Unicode and newline injection protection', () => {
    const input = {
      MSH: { ...msh(), '1': '!', '2': '$%?@' },
      PID: { '5': 'Éxample!A$B%C@D?folder\rOBX!1\n' },
    };
    expect(generateHl7(input)).toBe(jsonToHl7(input));
    expect(parseSegments(generateHl7(input)).segments.map((s) => s.name)).toEqual(['MSH', 'PID']);
  });
  it('keeps literal CR marker text and XML-like text in canonical payloads and decodes imported XML entities once', () => {
    const canonical = { MSH: msh(), NTE: { '3': 'Text {{CR13}} &amp; \\F\\' } };
    expect(generateHl7(canonical)).toBe(jsonToHl7(canonical));
    const imported = fixture();
    imported.HL7Message.NTE['NTE.3']['NTE.3.1'] = 'A &amp; B &lt; C &amp;lt; D\rOBX|1';
    const raw = generateHl7(imported);
    expect(raw).toContain('A \\T\\ B < C \\T\\lt; D\\X0D\\OBX\\F\\1');
    expect(parseSegments(raw).segments).toHaveLength(6);
  });
  it.each([
    null,
    [],
    'not an object',
    1,
    {},
    { MSH: [msh()] },
    { MSH: { ...msh(), '10': '' } },
    { MSH: msh(), PID: { '01': 'invalid' } },
    { MSH: msh(), PID: { '1001': 'invalid' } },
    { HL7Message: { MSH: msh() }, extra: true },
    { MSH: msh(), PID: { '1': { 'PID.2.1': 'wrong prefix' } } },
    { MSH: msh(), PID: { '1': 'one', 'PID.1': 'two' } },
    { MSH: msh(), PID: { '1': [[1]] } },
    { MSH: msh(), PID: [] },
    { MSH: msh(), PID: { '1': Infinity } },
    { MSH: msh(), PID: { '1': new Date() } },
    { MSH: msh(), PID: { '1': { '1': { '1': { '1': { '1': 'too deep' } } } } } },
    JSON.parse(
      '{"MSH":{"9":{"1":"MDM","2":"T02"},"10":"x","11":"T","12":"2.3"},"PID":{"__proto__":{"polluted":true}}}',
    ),
  ])(
    'rejects malformed or ambiguous objects without weakening canonical validation (%#)',
    (input) => {
      expect(() => generateHl7(input)).toThrow();
      expect(Object.prototype).not.toHaveProperty('polluted');
    },
  );
  it('rejects nonterminal segment markers, duplicate marker positions and missing clinical/message headers', () => {
    const input = fixture();
    input.HL7Message.PID['PID.1'] = '{{CR13}}';
    expect(() => generateHl7(input)).toThrow('Segment end markers must follow the last field');
    delete input.HL7Message.PID['PID.1'];
    input.HL7Message.MSH['15'] = 'AL';
    expect(() => generateHl7(input)).toThrow('Duplicate HL7 positions');
    delete input.HL7Message.MSH['15'];
    input.HL7Message.MSH['MSH.12'] = '';
    expect(() => generateHl7(input)).toThrow('Required MSH fields are missing');
  });
  it('enforces input/output/structural bounds and returns safe errors without supplied values', () => {
    expect(() => generateHl7(fixture(), 100)).toThrow('HL7 input exceeds');
    expect(() => generateHl7({ MSH: msh(), PID: { '1000': 'last' } }, 350)).toThrow(
      'HL7 output exceeds',
    );
    expect(() =>
      generateHl7({ MSH: msh(), PID: Array.from({ length: 21 }, () => ({ '1000': 'last' })) }),
    ).toThrow('HL7 structure exceeds');
    const cycle: Record<string, unknown> = { MSH: msh() };
    cycle.PID = cycle;
    expect(() => generateHl7(cycle)).toThrow('Invalid HL7 JSON structure');
    try {
      generateHl7({ MSH: msh(), PID: { 'SYNTHETIC-SECRET': 'secret' } });
    } catch (error) {
      expect(String(error)).not.toContain('SYNTHETIC-SECRET');
    }
  });
  it('leaves pre-existing raw HL7 strings unchanged', async () => {
    const raw = sample.replace(/\r/g, '\r\n');
    expect(await convertPayload(raw, 'HL7V2')).toBe(raw);
  });
  it('bounds sparse component expansion before passing it to the package', () => {
    const fields = Object.fromEntries(
      Array.from({ length: 21 }, (_, i) => [String(i + 1), { '1000': 'x' }]),
    );
    expect(() => generateHl7({ MSH: msh(), OBX: fields })).toThrow(
      'HL7 structure exceeds supported limits',
    );
  });
  it('keeps unknown MDM document/visit identifiers hidden in non-raw responses, including custom delimiters', () => {
    const imported = fixture();
    expect(maskPayload(imported)).toBe('[REDACTED]');
    expect(maskPayload(imported.HL7Message)).toBe('[REDACTED]');
    expect(maskPayload({ MSH: msh(), PID: { '5': 'Synthetic Name' } })).toBe('[REDACTED]');
    expect(maskPayload(generateHl7(imported))).toBe('[REDACTED TEXT]');
    expect(
      maskPayload(
        generateHl7({
          MSH: { ...msh(), '1': '!', '2': '$%?@' },
          TXA: { '12': 'SYNTHETIC-DOCUMENT' },
        }),
      ),
    ).toBe('[REDACTED TEXT]');
  });
  it('sanitizes package failures without returning patient data from exception text', () => {
    const write = vi.spyOn(hl7.Generator.prototype, 'writeSegment').mockImplementation(() => {
      throw new Error('SYNTHETIC-PRIVATE-PATIENT');
    });
    try {
      expect(() => generateHl7({ MSH: msh() })).toThrow(
        'Unable to generate HL7 from the supplied structure',
      );
    } finally {
      write.mockRestore();
    }
  });
});
