import { Ajv, type ValidateFunction } from 'ajv';
import { createHash } from 'node:crypto';
import { parseSegments } from '../utils/hl7Converer.js';
import { executeScript } from './script.services.js';
import { AppError } from '../utils/errors.js';
import { Parser } from 'xml2js';
import { xmlProfileSchema } from '../utils/validator.js';
import { config } from '../config/env.js';
import type { z } from 'zod';
export interface ValidationProfile {
  basicSyntax?: boolean;
  jsonSchema?: Record<string, unknown>;
  xml?: z.infer<typeof xmlProfileSchema>;
  hl7?: { messageTypes?: string[]; versions?: string[]; requiredFields?: string[] };
  script?: string;
}
const cache = new Map<string, ValidateFunction>();
function validator(schema: Record<string, unknown>) {
  const encoded = JSON.stringify(schema);
  if (
    encoded.length > 16384 ||
    /"(?:pattern|patternProperties|format|\$ref|\$async|uniqueItems)"\s*:/.test(encoded)
  )
    throw new AppError(
      400,
      'UNSUPPORTED_JSON_SCHEMA',
      'Schema exceeds limits or contains unsupported expensive/referenced keywords',
    );
  const checksum = createHash('sha256').update(encoded).digest('hex');
  let validate = cache.get(checksum);
  if (!validate) {
    try {
      validate = new Ajv({ strict: true, allErrors: false, validateFormats: false }).compile(
        schema,
      );
    } catch {
      throw new AppError(400, 'INVALID_JSON_SCHEMA', 'Invalid JSON Schema');
    }
    if (cache.size >= 128) cache.delete(cache.keys().next().value!);
    cache.set(checksum, validate);
  }
  return validate;
}
export function validateProfileConfiguration(profile: ValidationProfile) {
  if (profile.jsonSchema) validator(profile.jsonSchema);
  if (profile.xml && !xmlProfileSchema.safeParse(profile.xml).success)
    throw new AppError(400, 'INVALID_XML_PROFILE', 'Invalid XML profile rules');
}
function xmlValues(root: unknown, path: string) {
  let values: unknown[] = [root];
  for (const key of path.split('.')) {
    const next: unknown[] = [];
    for (const value of values)
      if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key)) {
        const child = (value as Record<string, unknown>)[key];
        next.push(...(Array.isArray(child) ? child : [child]));
      }
    values = next;
  }
  return values;
}
async function validateXml(payload: unknown, profile: ValidationProfile['xml']) {
  if (typeof payload !== 'string' || Buffer.byteLength(payload) > config.server.payloadLimit)
    throw new AppError(422, 'XML_INVALID', 'XML payload must be a bounded document');
  if (/<!DOCTYPE|<!ENTITY/i.test(payload))
    throw new AppError(422, 'XML_ENTITIES_DENIED', 'XML entity declarations are not supported');
  let nodes = 0;
  let parsed: Record<string, unknown>;
  try {
    parsed = await new Parser({
      strict: true,
      explicitRoot: true,
      explicitArray: true,
      async: true,
      chunkSize: 8192,
      validator: (path: string, _old: unknown, value: unknown) => {
        if (++nodes > 20000 || path.split('/').length > 65) throw new Error('XML_LIMIT');
        return value;
      },
    }).parseStringPromise(payload);
    if (!parsed || typeof parsed !== 'object') throw new Error('XML_EMPTY');
  } catch {
    throw new AppError(422, 'XML_INVALID', 'XML document is invalid or exceeds structural limits');
  }
  if (profile?.root && !Object.prototype.hasOwnProperty.call(parsed, profile.root))
    throw new AppError(422, 'XML_PROFILE_REJECTED', 'XML root does not match channel profile');
  const text = (value: unknown) =>
    typeof value === 'string'
      ? value
      : value && typeof value === 'object'
        ? (value as Record<string, unknown>)['_']
        : undefined;
  for (const path of profile?.requiredPaths || [])
    if (
      !xmlValues(parsed, path).some(
        (value) => typeof text(value) === 'string' && String(text(value)).trim().length > 0,
      )
    )
      throw new AppError(422, 'XML_PROFILE_REJECTED', 'Required XML text element is missing');
  for (const rule of profile?.values || []) {
    const values = xmlValues(parsed, rule.path);
    if (
      !values.length ||
      values.some(
        (value) => typeof text(value) !== 'string' || !rule.allowed.includes(String(text(value))),
      )
    )
      throw new AppError(
        422,
        'XML_PROFILE_REJECTED',
        'XML element value does not match channel profile',
      );
  }
}
export async function validatePayload(
  payload: unknown,
  type: string,
  profile: ValidationProfile = {},
) {
  if (type === 'JSON' && profile.basicSyntax) {
    // HTTP and the preview editor parse JSON before this stage. A string here can
    // be a valid JSON string scalar, so it must not be parsed a second time.
    try {
      const encoded = JSON.stringify(payload, (_key, value: unknown) => {
        if (
          value === undefined ||
          typeof value === 'function' ||
          typeof value === 'symbol' ||
          (typeof value === 'number' && !Number.isFinite(value))
        )
          throw new Error('JSON_VALUE_INVALID');
        return value;
      });
      if (encoded === undefined || Buffer.byteLength(encoded) > config.server.payloadLimit)
        throw new Error('JSON_LIMIT');
    } catch {
      throw new AppError(422, 'JSON_INVALID', 'JSON payload is invalid');
    }
  }
  if (type === 'JSON' && profile.jsonSchema && !validator(profile.jsonSchema)(payload))
    throw new AppError(
      422,
      'PAYLOAD_SCHEMA_REJECTED',
      'Payload does not match channel JSON Schema',
    );
  if (type === 'XML') await validateXml(payload, profile.xml);
  if (type === 'HL7V2') {
    const parsed = parseSegments(String(payload)),
      msh = parsed.segments[0].fields;
    if (profile.hl7?.messageTypes?.length && !profile.hl7.messageTypes.includes(msh[9]))
      throw new AppError(
        422,
        'HL7_PROFILE_REJECTED',
        'HL7 message type does not match channel profile',
      );
    if (profile.hl7?.versions?.length && !profile.hl7.versions.includes(msh[12]))
      throw new AppError(422, 'HL7_PROFILE_REJECTED', 'HL7 version does not match channel profile');
    for (const path of profile.hl7?.requiredFields || []) {
      const [segment, field] = path.split('.');
      if (!parsed.segments.some((s) => s.name === segment && s.fields[Number(field)]))
        throw new AppError(422, 'HL7_PROFILE_REJECTED', 'Required HL7 field is missing');
    }
  }
  if (profile.script?.trim() && !(await executeScript(profile.script, { msg: payload }, 'true')))
    throw new AppError(422, 'PAYLOAD_VALIDATION_REJECTED', 'Channel validation rejected payload');
}
