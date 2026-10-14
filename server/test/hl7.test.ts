import { describe, it, expect } from 'vitest';
import {
  parseSegments,
  hl7ToJson,
  jsonToHl7,
  buildAck,
  readAck,
} from '../src/utils/hl7Converer.js';
import { parseHL7ToTree } from '../src/services/hl7Parser.service.js';
import { frame, MllpDecoder } from '../src/utils/mllp.js';
import { decodeEscapes } from '../src/utils/hl7Fields.js';
import { sample } from './fixtures.js';

describe('HL7 interoperability', () => {
  const msh = { '9': { '1': 'ADT', '2': 'A01' }, '10': 'JSON001', '11': 'P', '12': '2.5' };
  it('places MSH first and supplies default delimiters without mutating JSON', () => {
    const input = { PID: { '3': 'RM001' }, MSH: msh };
    const raw = jsonToHl7(input);
    expect(raw.startsWith('MSH|^~\\&|')).toBe(true);
    expect(parseSegments(raw).segments.map((s) => s.name)).toEqual(['MSH', 'PID']);
    expect(input.MSH).toEqual(msh);
    expect(input.MSH).not.toHaveProperty('1');
  });
  it('escapes ordinary delimiters and prevents newline segment injection', () => {
    const raw = jsonToHl7({ MSH: msh, PID: { '5': 'Budi|Santoso^A~B&C\\folder\rOBX|1\n' } });
    const parsed = parseSegments(raw);
    expect(parsed.segments.map((s) => s.name)).toEqual(['MSH', 'PID']);
    expect(parsed.segments[1].fields[5]).toBe(
      'Budi\\F\\Santoso\\S\\A\\R\\B\\T\\C\\E\\folder\\X0D\\OBX\\F\\1\\X0A\\',
    );
    expect(parsed.segments[1].fields).toHaveLength(6);
  });
  it('escapes component values while preserving existing encoded values', () => {
    const raw = jsonToHl7({ MSH: msh, PID: { '5': { '1': 'A^B', '2': 'C\\F\\D' } } });
    expect(hl7ToJson(raw).PID).toMatchObject({ '5': { '1': 'A\\S\\B', '2': 'C\\F\\D' } });
  });
  it('escapes using custom delimiters', () => {
    const raw = jsonToHl7({
      MSH: { ...msh, '1': '!', '2': '$%?@' },
      PID: { '5': 'A!B$C%D@E?path' },
    });
    expect(parseSegments(raw).segments[1].fields[5]).toBe('A?F?B?S?C?R?D?T?E?E?path');
  });
  for (const invalid of [
    {},
    { MSH: [msh] },
    { MSH: { ...msh, '1': '||' } },
    { MSH: { ...msh, '2': '^^^^' } },
    { MSH: { ...msh, '10': '' } },
    { MSH: msh, PID: { '01': 'bad' } },
    { MSH: msh, PID: [[{ '1': 'bad' }]] },
  ])
    it('rejects invalid JSON structure ' + JSON.stringify(invalid), () => {
      expect(() => jsonToHl7(invalid)).toThrow();
    });
  it('parses repetitions and subcomponents and explicitly decodes escapes', () => {
    const obj = hl7ToJson(sample);
    expect((obj.OBX as Record<string, unknown>[])[0]['5']).toEqual([
      'A\\F\\B',
      { '1': { '1': 'C', '2': 'D' } },
    ]);
    expect(decodeEscapes('A\\F\\B', parseSegments(sample).delimiters)).toBe('A|B');
  });
  for (const separator of ['\r', '\r\n', '\n'])
    it(`accepts separator ${JSON.stringify(separator)}`, () => {
      const raw = sample.replace(/\r/g, separator);
      expect(parseSegments(raw).segments).toHaveLength(4);
      expect(hl7ToJson(raw).MSH).toMatchObject({
        '1': '|',
        '2': '^~\\&',
        '9': { '1': 'ORU', '2': 'R01' },
        '10': 'ID123',
      });
    });
  for (const type of ['ADT^A01', 'ORM^O01', 'ORU^R01', 'SIU^S12', 'DFT^P03', 'MDM^T02'])
    it(type, () =>
      expect(parseSegments(sample.replace('ORU^R01', type)).segments[0].fields[9]).toBe(type),
    );
  it('preserves repeated segments, escapes, repetitions and subcomponents', () =>
    expect(jsonToHl7(hl7ToJson(sample))).toBe(sample));
  it('supports custom separators and correct MSH numbering', () => {
    const raw = sample.replace(/\|/g, '!').replace(/\^/g, '$');
    expect(parseSegments(raw).delimiters.component).toBe('$');
    expect(jsonToHl7(hl7ToJson(raw))).toBe(raw);
    expect(parseHL7ToTree(raw)[0].children?.find((n) => n.name === 'MSH.10')?.value).toBe('ID123');
  });
  for (const raw of [
    '',
    'PID|1',
    sample.replace('|ID123|', '||'),
    sample.replace('|P|2.5', '||2.5'),
    sample.replace('ORU^R01', ''),
  ])
    it('rejects missing required MSH fields ' + raw.slice(0, 10), () =>
      expect(() => parseSegments(raw)).toThrow(),
    );
  for (const code of ['AA', 'AE', 'AR'] as const)
    it('builds dynamic ' + code, () => {
      const ack = buildAck(sample, code);
      expect(ack).toContain('MSA|' + code + '|ID123');
      expect(ack).toContain('|LIS|LAB|HIS|HOSP|');
      expect(ack).toContain('|ACK^R01^ACK|');
      expect(ack).toContain('|P|2.5');
      expect(ack).toMatch(/\|\d{14}\+0000\|/);
    });
  it('checks ACK control id and NACK', () => {
    expect(readAck(buildAck(sample, 'AA'), 'ID123').code).toBe('AA');
    expect(() => readAck(buildAck(sample, 'AE'), 'ID123')).toThrow();
    expect(() => readAck(buildAck(sample, 'AA'), 'wrong')).toThrow();
  });
});
describe('MLLP stream decoder', () => {
  it('complete frame', () => expect(new MllpDecoder().push(frame(sample))).toEqual([sample]));
  it('fragmentation at every byte boundary', () => {
    const bytes = frame(sample);
    for (let split = 1; split < bytes.length; split++) {
      const decoder = new MllpDecoder();
      expect(decoder.push(bytes.subarray(0, split))).toEqual([]);
      expect(decoder.push(bytes.subarray(split))).toEqual([sample]);
    }
  });
  it('multiple frames', () =>
    expect(new MllpDecoder().push(Buffer.concat([frame(sample), frame(sample)]))).toEqual([
      sample,
      sample,
    ]));
  it('fragmented UTF8', () => {
    const decoder = new MllpDecoder();
    const bytes = frame('é');
    expect(decoder.push(bytes.subarray(0, 2))).toEqual([]);
    expect(decoder.push(bytes.subarray(2))).toEqual(['é']);
  });
  it('invalid framing', () => {
    expect(() => new MllpDecoder().push(Buffer.from('not framed'))).toThrow();
    expect(() => new MllpDecoder().push(Buffer.from('\x0bMSH\x1cX'))).toThrow();
  });
  it('bounded buffer', () => expect(() => new MllpDecoder(4).push(frame('12345'))).toThrow());
  it('flags incomplete close', () => {
    const d = new MllpDecoder();
    d.push(Buffer.from('\x0bMSH'));
    expect(d.incomplete).toBe(true);
  });
});
