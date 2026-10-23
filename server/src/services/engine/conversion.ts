import { Builder, Parser } from 'xml2js';
import { jsonToHl7, hl7ToJson, parseSegments } from '../../utils/hl7Converer.js';
import { AppError } from '../../utils/errors.js';
import { config } from '../../config/env.js';
async function parseXml(value: string) {
  if (Buffer.byteLength(value) > config.server.payloadLimit)
    throw new AppError(422, 'XML_INVALID', 'XML document exceeds the configured size limit');
  if (/<!DOCTYPE|<!ENTITY/i.test(value))
    throw new AppError(422, 'XML_ENTITIES_DENIED', 'XML entity declarations are not supported');
  let nodes = 0;
  try {
    const parsed = await new Parser({
      strict: true,
      explicitArray: false,
      explicitRoot: true,
      async: true,
      chunkSize: 8192,
      validator: (path: string, _old: unknown, node: unknown) => {
        if (++nodes > 20000 || path.split('/').length > 65) throw new Error('XML_LIMIT');
        return node;
      },
    }).parseStringPromise(value);
    if (!parsed || typeof parsed !== 'object') throw new Error('XML_EMPTY');
    return parsed;
  } catch {
    throw new AppError(422, 'XML_INVALID', 'XML document is invalid or exceeds structural limits');
  }
}
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
    if (value.trim().startsWith('<')) return parseXml(value);
    try {
      return JSON.parse(value);
    } catch {
      return { raw: value };
    }
  }
  if (type === 'XML') {
    const output =
      typeof value === 'string' && value.trim().startsWith('<')
        ? value
        : new Builder({ headless: true }).buildObject(
            typeof value === 'string' ? { raw: value } : value,
          );
    await parseXml(output);
    return output;
  }
  return typeof value === 'string' ? value : serialize(value);
}
