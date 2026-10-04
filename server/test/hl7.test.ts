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
