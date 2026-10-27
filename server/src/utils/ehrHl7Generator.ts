import hl7 from '@ehr/hl7-v2';
import { randomUUID } from 'node:crypto';
import { AppError } from './errors.js';
import { delimiters, parseSegments } from './hl7Converer.js';
import { buildField } from './hl7Fields.js';

type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}
function invalid(message = 'Invalid HL7 JSON structure'): never {
  throw new AppError(422, 'INVALID_HL7_OBJECT', message);
}
function position(key: string, parent: string): string {
  const suffix = key.startsWith(parent + '.') ? key.slice(parent.length + 1) : key;
  if (!/^[1-9]\d{0,3}$/.test(suffix) || Number(suffix) > 1000)
    invalid('Use numeric HL7 positions or matching segment-prefixed positions');
  return suffix;
}
function xmlText(value: string): string {
  // Decode one layer only for the XML-shaped import. Never interpret markup/DTDs.
  const entities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
  };
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => entities[name]);
}
function endMarker(value: unknown, parent: string, depth = 0): boolean {
  if (value === '{{CR13}}') return true;
  if (depth >= 3 || !record(value) || Object.keys(value).length !== 1) return false;
  const [key, child] = Object.entries(value)[0];
  if (key !== '1' && key !== parent + '.1') return false;
  return endMarker(child, parent + '.1', depth + 1);
}

/** Package-backed ER7 generation. Flat segment order is a compatibility profile,
 * not proof of conformance to a hospital's clinical HL7 message specification. */
export function generateHl7(input: unknown, maxBytes = 1048576): string {
  if (!record(input)) invalid('HL7 object required');
  try {
    if (Buffer.byteLength(JSON.stringify(input)) > maxBytes)
      throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'HL7 input exceeds the configured size limit');
  } catch (error) {
    if (error instanceof AppError) throw error;
    invalid();
  }
  const wrapped = Object.prototype.hasOwnProperty.call(input, 'HL7Message');
  if (wrapped && (Object.keys(input).length !== 1 || !record(input.HL7Message))) invalid();
  const root = (wrapped ? input.HL7Message : input) as RecordValue;
  if (!record(root.MSH)) invalid('Exactly one MSH object required');
  const imported = wrapped || Object.keys(root.MSH).some((key) => key.startsWith('MSH.'));
  let nodes = 0;
  let slots = 0;
  function normalize(value: unknown, parent: string, depth = 0): unknown {
    if (++nodes > 20000 || depth > 3) invalid('HL7 structure exceeds supported limits');
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return imported ? xmlText(value) : value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
      if (depth !== 0 || value.some(Array.isArray)) invalid('Invalid HL7 repetitions');
      return value.map((item) => normalize(item, parent, 1));
    }
    if (!record(value)) invalid();
    const width = Math.max(0, ...Object.keys(value).map((key) => Number(position(key, parent))));
    if ((slots += width) > 20000) invalid('HL7 structure exceeds supported limits');
    const normalized: RecordValue = Object.create(null);
    for (const [key, child] of Object.entries(value)) {
      const index = position(key, parent);
      if (Object.prototype.hasOwnProperty.call(normalized, index))
        invalid('Duplicate HL7 positions');
      normalized[index] = normalize(child, parent + '.' + index, depth + 1);
    }
    return normalized;
  }
  const message: RecordValue = Object.create(null);
  for (const [name, value] of Object.entries(root)) {
    if (!/^[A-Z0-9]{3}$/.test(name)) invalid('Invalid segment name');
    const entries = Array.isArray(value) ? value : [value];
    if (!entries.length) invalid('Empty segment repetition');
    const normalized = entries.map((fields) => {
      if (!record(fields) || ++nodes > 20000) invalid('Invalid segment fields');
      const result: RecordValue = Object.create(null);
      const indexes = Object.keys(fields).map((key) => Number(position(key, name)));
      const last = Math.max(0, ...indexes);
      if ((slots += last) > 20000) invalid('HL7 structure exceeds supported limits');
      const seen = new Set<string>();
      for (const [key, field] of Object.entries(fields)) {
        const index = position(key, name);
        if (seen.has(index)) invalid('Duplicate HL7 positions');
        seen.add(index);
        if (imported && endMarker(field, name + '.' + index)) {
          if (Number(index) !== last) invalid('Segment end markers must follow the last field');
          // These imported terminal nodes encode the segment boundary, not clinical fields.
          // The package writes the actual CR boundary exactly once.
          continue;
        }
        result[index] = normalize(field, name + '.' + index);
      }
      return result;
    });
    message[name] = Array.isArray(value) ? normalized : normalized[0];
  }
  const msh = message.MSH as RecordValue;
  if (
    (typeof msh['1'] !== 'undefined' && typeof msh['1'] !== 'string') ||
    (typeof msh['2'] !== 'undefined' && typeof msh['2'] !== 'string')
  )
    throw new AppError(422, 'INVALID_HL7_DELIMITERS', 'Invalid HL7 delimiters');
  const field = (msh['1'] as string | undefined) ?? '|';
  const encoding = (msh['2'] as string | undefined) ?? '^~\\&';
  if (field.length !== 1 || encoding.length !== 4)
    throw new AppError(422, 'INVALID_HL7_DELIMITERS', 'Invalid HL7 delimiters');
  const d = delimiters('MSH' + field + encoding);
  if (imported) {
    if (!buildField(msh['7'], d))
      msh['7'] = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '+0000';
    if (!buildField(msh['10'], d)) msh['10'] = randomUUID();
  }
  for (const n of ['9', '10', '11', '12'])
    if (!buildField(msh[n], d)) invalid('Required MSH fields are missing');

  // Use a per-call flat schema: the package's default grouped schemas would drop
  // legacy flat segments, and require groups absent in these XML-shaped imports.
  // Never merge an untrusted schema into the package's process-wide definitions.
  const headerType = msh['9'] as Record<string, unknown>;
  const type = String(headerType['1']);
  const event = type === 'ACK' ? 'ACK' : String(headerType['2']);
  const segmentSchema: Record<string, unknown> = Object.create(null);
  const schema = {
    structure: { [type]: { [event]: 'MIRTH_FLAT' } },
    messages: {
      MIRTH_FLAT: {
        MIRTH_FLAT: {
          elements: [
            { segment: 'MSH', minOccurs: '1', maxOccurs: '1' },
            ...Object.keys(message)
              .filter((name) => name !== 'MSH')
              .map((segment) => ({
                segment,
                minOccurs: '0',
                maxOccurs: 'unbounded',
              })),
          ],
        },
      },
    },
    segments: segmentSchema,
  };
  const generator = new hl7.Generator(undefined, { ...d, subComponent: d.subcomponent });
  generator.schema(schema, false);
  // Retain the existing lossless escape policy and CR/LF injection protection.
  // The package's default field writer re-escapes existing sequences, loses 0/false
  // in several schema types and does not escape raw CR/LF data.
  generator.writeField = (value) => buildField(value, d);
  const writeSegment = generator.writeSegment;
  generator.writeSegment = function (value, name) {
    const max = Math.max(0, ...Object.keys(value).map(Number));
    segmentSchema[name] = { fields: Array.from({ length: max }, () => ({ maxOccurs: '1' })) };
    return writeSegment.call(this, value, name);
  };
  try {
    const output = generator.write(message);
    if (Buffer.byteLength(output) > maxBytes)
      throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'HL7 output exceeds the configured size limit');
    parseSegments(output);
    return output;
  } catch (error) {
    if (error instanceof AppError) throw error;
    invalid('Unable to generate HL7 from the supplied structure');
  }
}
