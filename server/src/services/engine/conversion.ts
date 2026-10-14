import { Builder, parseStringPromise } from 'xml2js';
import { jsonToHl7, hl7ToJson, parseSegments } from '../../utils/hl7Converer.js';
export function serialize(value: unknown) {
  return JSON.stringify(value ?? null);
}
export async function convertPayload(value: unknown, type: string): Promise<unknown> {
  if (type === 'HL7V2') {
    const raw = typeof value === 'string' ? value : jsonToHl7(value);
    parseSegments(raw);
    return raw;
  }
  if (type === 'JSON') {
    if (typeof value !== 'string') return value;
    if (value.startsWith('MSH')) return hl7ToJson(value);
    if (value.trim().startsWith('<')) return parseStringPromise(value, { explicitArray: false });
    try {
      return JSON.parse(value);
    } catch {
      return { raw: value };
    }
  }
  if (type === 'XML')
    return typeof value === 'string' && value.trim().startsWith('<')
      ? value
      : new Builder({ headless: true }).buildObject(
          typeof value === 'string' ? { raw: value } : value,
        );
  return typeof value === 'string' ? value : serialize(value);
}
