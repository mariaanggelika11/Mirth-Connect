import { parseField, buildField } from './hl7Fields.js';
import { randomUUID } from 'node:crypto';
import { AppError } from './errors.js';
export interface Delimiters {
  field: string;
  component: string;
  repetition: string;
  escape: string;
  subcomponent: string;
}
export interface HL7Segment {
  name: string;
  fields: string[];
}
export function delimiters(raw: string): Delimiters {
  if (typeof raw !== 'string' || !raw.startsWith('MSH') || raw.length < 8)
    throw new AppError(400, 'INVALID_HL7', 'Missing MSH segment');
  const chars = raw.slice(3, 8);
  if (new Set(chars).size !== 5 || /[\w\s]/.test(chars))
    throw new AppError(400, 'INVALID_HL7_DELIMITERS', 'Invalid HL7 delimiters');
  return {
    field: chars[0],
    component: chars[1],
    repetition: chars[2],
    escape: chars[3],
    subcomponent: chars[4],
  };
}
export function parseSegments(raw: string): { delimiters: Delimiters; segments: HL7Segment[] } {
  const d = delimiters(raw);
  const segments = raw
    .split(/\r\n|\r|\n/)
    .filter(Boolean)
    .map((line) => {
      const fields = line.split(d.field);
      const name = fields.shift()!;
      if (!/^[A-Z0-9]{3}$/.test(name))
        throw new AppError(400, 'INVALID_HL7_SEGMENT', 'Invalid HL7 segment');
      return { name, fields: name === 'MSH' ? ['', d.field, ...fields] : ['', ...fields] };
    });
  const msh = segments[0];
  for (const n of [9, 10, 11, 12])
    if (!msh.fields[n]) throw new AppError(400, 'INVALID_HL7', 'Required MSH fields are missing');
  return { delimiters: d, segments };
}
// Preserve raw escapes, repetitions and subcomponents for lossless round trips.
// Single components retain the established msg.PID['5']['2'] interface.
export function hl7ToJson(raw: string): Record<string, unknown> {
  const { delimiters: d, segments } = parseSegments(raw);
  const result: Record<string, unknown> = {};
  for (const segment of segments) {
    const fields: Record<string, unknown> = {};
    segment.fields.slice(1).forEach((v, index) => {
      const n = index + 1;
      fields[String(n)] = segment.name === 'MSH' && n <= 2 ? v : parseField(v, d);
    });
    const prev = result[segment.name];
    if (prev === undefined) result[segment.name] = fields;
    else if (Array.isArray(prev)) prev.push(fields);
    else result[segment.name] = [prev, fields];
  }
  return result;
}
export function jsonToHl7(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new AppError(400, 'INVALID_HL7_OBJECT', 'HL7 object required');
  const obj = input as Record<string, unknown>;
  const msh = obj.MSH as Record<string, unknown>;
  const f = typeof msh?.['1'] === 'string' ? msh['1'] : '|';
  const enc = typeof msh?.['2'] === 'string' ? msh['2'] : '^~\\&';
  const segments: string[] = [];
  for (const [name, value] of Object.entries(obj)) {
    if (!/^[A-Z0-9]{3}$/.test(name))
      throw new AppError(400, 'INVALID_HL7_OBJECT', 'Invalid segment name');
    for (const fields of Array.isArray(value) ? value : [value]) {
      if (!fields || typeof fields !== 'object')
        throw new AppError(400, 'INVALID_HL7_OBJECT', 'Invalid segment fields');
      const rec = fields as Record<string, unknown>;
      const indexes = Object.keys(rec).map(Number);
      if (indexes.some((n) => !Number.isInteger(n) || n < 1 || n > 1000))
        throw new AppError(400, 'INVALID_HL7_OBJECT', 'Invalid field index');
      const max = Math.max(0, ...indexes);
      const values: string[] = [];
      for (let n = name === 'MSH' ? 2 : 1; n <= max; n++) {
        const v = rec[String(n)];
        values.push(
          name === 'MSH' && n <= 2
            ? String(v ?? '')
            : buildField(v, {
                field: f,
                component: enc[0],
                repetition: enc[1],
                escape: enc[2],
                subcomponent: enc[3],
              }),
        );
      }
      segments.push(name + f + values.join(f));
    }
  }
  return segments.join('\r') + '\r';
}
export function buildAck(raw: string, code: 'AA' | 'AE' | 'AR', reason = ''): string {
  let d: Delimiters = {
    field: '|',
    component: '^',
    repetition: '~',
    escape: '\\',
    subcomponent: '&',
  };
  try {
    d = delimiters(raw);
  } catch {
    /* malformed input still receives AR */
  }
  const p = String(raw)
    .split(/\r\n|\r|\n/)[0]
    .split(d.field);
  const f = d.field,
    c = d.component;
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '+0000';
  const event = (p[8] || '').split(c)[1];
  const ackType = ['ACK', event, 'ACK'].join(c);
  const cleanReason = reason.replace(/[\r\n|^~\\&]/g, ' ').slice(0, 100);
  return (
    [
      'MSH',
      p[1] || '^~\\&',
      p[4] || '',
      p[5] || '',
      p[2] || '',
      p[3] || '',
      stamp,
      '',
      ackType,
      randomUUID(),
      p[10] || 'P',
      p[11] || '2.5',
    ].join(f) +
    '\r' +
    ['MSA', code, p[9] || '', cleanReason].join(f) +
    '\r'
  );
}
export function readAck(raw: string, expectedControlId: string) {
  const parsed = parseSegments(raw);
  const msa = parsed.segments.find((s) => s.name === 'MSA');
  if (!msa || msa.fields[2] !== expectedControlId || !['AA', 'AE', 'AR'].includes(msa.fields[1]))
    throw new AppError(502, 'INVALID_ACK', 'Missing or mismatched ACK');
  if (msa.fields[1] !== 'AA')
    throw new AppError(502, 'HL7_NACK_' + msa.fields[1], 'Destination rejected message');
  return { code: msa.fields[1], messageControlId: msa.fields[2] };
}
