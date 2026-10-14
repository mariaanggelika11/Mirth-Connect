import { Ajv, type ValidateFunction } from 'ajv';
import { createHash } from 'node:crypto';
import { parseSegments } from '../utils/hl7Converer.js';
import { executeScript } from './script.services.js';
import { AppError } from '../utils/errors.js';
export interface ValidationProfile {
  jsonSchema?: Record<string, unknown>;
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
}
export async function validatePayload(
  payload: unknown,
  type: string,
  profile: ValidationProfile = {},
) {
  if (type === 'JSON' && profile.jsonSchema && !validator(profile.jsonSchema)(payload))
    throw new AppError(
      422,
      'PAYLOAD_SCHEMA_REJECTED',
      'Payload does not match channel JSON Schema',
    );
  if (type === 'XML' && /<!DOCTYPE|<!ENTITY/i.test(String(payload)))
    throw new AppError(422, 'XML_ENTITIES_DENIED', 'XML entity declarations are not supported');
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
