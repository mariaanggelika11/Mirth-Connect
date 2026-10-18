import { Ajv, type ValidateFunction } from 'ajv';
import { createHash } from 'node:crypto';
import { parseSegments } from '../utils/hl7Converer.js';
import { executeScript } from './script.services.js';
import { AppError } from '../utils/errors.js';
import { Parser } from 'xml2js';
import {
  xmlProfileSchema,
  legacyValidationProfileSchema,
  validationProfileSchema,
} from '../utils/validator.js';
import { config } from '../config/env.js';
import type { z } from 'zod';
import {
  fieldRuleErrors,
  type FieldRule,
  type ValidationRuleResult,
  type ValidationSettings,
} from '../utils/validationRules.js';
type LegacyProfile = z.infer<typeof legacyValidationProfileSchema>;
export type ValidationProfile = LegacyProfile | ValidationSettings | Record<string, unknown>;
export class FieldValidationError extends AppError {
  readonly results: readonly ValidationRuleResult[];
  constructor(results: ValidationRuleResult[]) {
    super(422, 'FIELD_VALIDATION_FAILED', 'Message does not match the configured field rules.');
    this.results = Object.freeze(results.map((result) => Object.freeze({ ...result })));
  }
}
const cache = new Map<string, ValidateFunction>();
function validator(schema: Record<string, unknown>) {
  const encoded = JSON.stringify(schema);
  if (/"format"\s*:/.test(encoded))
    throw new AppError(
      400,
      'UNSUPPORTED_JSON_SCHEMA',
      'JSON Schema format validation is not supported. Use a date field rule for YYYY-MM-DD values.',
    );
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
function activeProfile(profile: ValidationProfile, type?: string): LegacyProfile | FieldRule[] {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile))
    throw new AppError(400, 'INVALID_VALIDATION_PROFILE', 'Use a validation settings object.');
  const candidate = profile as Record<string, unknown>;
  const selectedProfile =
    candidate.version === 1
      ? candidate.mode === 'CUSTOM'
        ? candidate.custom
        : candidate.mode === 'LEGACY'
          ? candidate.legacy
          : undefined
      : candidate;
  if (
    selectedProfile &&
    typeof selectedProfile === 'object' &&
    'xml' in selectedProfile &&
    !xmlProfileSchema.safeParse(selectedProfile.xml).success
  )
    throw new AppError(400, 'INVALID_XML_PROFILE', 'Invalid XML profile rules');
  if (candidate.version === 1 && candidate.mode === 'FIELDS') {
    const error = fieldRuleErrors(candidate.fieldRules)[0];
    if (error)
      throw new AppError(
        400,
        'INVALID_FIELD_RULES',
        `${error.index >= 0 ? `Rule ${error.index + 1}: ` : ''}${error.message}`,
      );
  }
  const parsed = validationProfileSchema.safeParse(profile);
  if (!parsed.success)
    throw new AppError(
      400,
      'INVALID_VALIDATION_PROFILE',
      'Use supported validation settings. Custom JSON Schema belongs inside jsonSchema.',
    );
  if (!('version' in parsed.data)) return parsed.data;
  const settings = parsed.data;
  if (settings.mode === 'NONE') return {};
  if (settings.mode === 'FIELDS') {
    if (type && type !== 'JSON')
      throw new AppError(
        400,
        'VALIDATION_FORMAT_UNSUPPORTED',
        'Field rules currently support JSON input. Use a custom profile for this format.',
      );
    return settings.fieldRules as unknown as FieldRule[];
  }
  const selected = settings.mode === 'LEGACY' ? settings.legacy : settings.custom;
  const legacy = legacyValidationProfileSchema.safeParse(selected);
  if (!legacy.success)
    throw new AppError(
      400,
      'INVALID_VALIDATION_PROFILE',
      'Use supported validation settings. Custom JSON Schema belongs inside jsonSchema.',
    );
  if (settings.mode === 'LEGACY') return legacy.data;
  const custom = legacy.data;
  if (
    type &&
    ((custom.jsonSchema && type !== 'JSON') ||
      (custom.xml && type !== 'XML') ||
      (custom.hl7 && type !== 'HL7V2'))
  )
    throw new AppError(
      400,
      'VALIDATION_FORMAT_UNSUPPORTED',
      'The custom validation profile must match the source input format.',
    );
  const configured =
    custom.basicSyntax === true ||
    !!custom.script?.trim() ||
    !!custom.jsonSchema ||
    !!(
      custom.xml &&
      (custom.xml.root || custom.xml.requiredPaths?.length || custom.xml.values?.length)
    ) ||
    !!(
      custom.hl7 &&
      (custom.hl7.messageTypes?.length ||
        custom.hl7.versions?.length ||
        custom.hl7.requiredFields?.length)
    );
  if (!configured)
    throw new AppError(
      400,
      'INVALID_VALIDATION_PROFILE',
      'Add a custom validation rule or select No additional validation.',
    );
  return custom;
}
export function validateProfileConfiguration(profile: ValidationProfile, type?: string) {
  const active = activeProfile(profile, type);
  if (Array.isArray(active)) return;
  if (active.jsonSchema) validator(active.jsonSchema);
  if (active.xml && !xmlProfileSchema.safeParse(active.xml).success)
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
async function validateXml(payload: unknown, profile: LegacyProfile['xml']) {
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
  const active = activeProfile(profile, type);
  const rules = Array.isArray(active) ? active : undefined;
  const current = Array.isArray(active) ? {} : active;
  if (type === 'JSON' && (current.basicSyntax || rules)) {
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
  if (rules) {
    const results = evaluateFieldRules(payload, rules);
    if (results.some((result) => result.status === 'FAILED'))
      throw new FieldValidationError(results);
    return results;
  }
  if (type === 'JSON' && current.jsonSchema && !validator(current.jsonSchema)(payload))
    throw new AppError(
      422,
      'PAYLOAD_SCHEMA_REJECTED',
      'Payload does not match channel JSON Schema',
    );
  if (type === 'XML') await validateXml(payload, current.xml);
  if (type === 'HL7V2') {
    const parsed = parseSegments(String(payload)),
      msh = parsed.segments[0].fields;
    if (current.hl7?.messageTypes?.length && !current.hl7.messageTypes.includes(msh[9]))
      throw new AppError(
        422,
        'HL7_PROFILE_REJECTED',
        'HL7 message type does not match channel profile',
      );
    if (current.hl7?.versions?.length && !current.hl7.versions.includes(msh[12]))
      throw new AppError(422, 'HL7_PROFILE_REJECTED', 'HL7 version does not match channel profile');
    for (const path of current.hl7?.requiredFields || []) {
      const [segment, field] = path.split('.');
      if (!parsed.segments.some((s) => s.name === segment && s.fields[Number(field)]))
        throw new AppError(422, 'HL7_PROFILE_REJECTED', 'Required HL7 field is missing');
    }
  }
  if (current.script?.trim() && !(await executeScript(current.script, { msg: payload }, 'true')))
    throw new AppError(422, 'PAYLOAD_VALIDATION_REJECTED', 'Channel validation rejected payload');
}

function fieldValue(payload: unknown, path: string): unknown {
  let value = payload;
  for (const part of path.split('.')) {
    if (!value || typeof value !== 'object') return undefined;
    // Own data properties only: prototype properties and accessors are never followed.
    const descriptor = Object.getOwnPropertyDescriptor(value, part);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return undefined;
    value = descriptor.value;
  }
  return value;
}
function calendarDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}
function evaluateFieldRules(payload: unknown, rules: FieldRule[]): ValidationRuleResult[] {
  return rules.map((rule) => {
    const base = { field: rule.field, type: rule.type, required: rule.required };
    const fail = (code: string, message: string): ValidationRuleResult => ({
      ...base,
      status: 'FAILED',
      code,
      message,
    });
    if (!payload || typeof payload !== 'object')
      return fail('TYPE', 'The message must be a JSON object or array.');
    const value = fieldValue(payload, rule.field);
    if (
      rule.required &&
      (value === undefined || value === null || (typeof value === 'string' && !value.trim()))
    )
      return fail('REQUIRED', 'Required field is missing or empty.');
    if (value === undefined)
      return { ...base, status: 'SKIPPED', message: 'Optional field is missing.' };
    if (rule.type === 'date') {
      if (typeof value !== 'string')
        return fail('TYPE', 'Expected a date string in YYYY-MM-DD format.');
      if (!calendarDate(value))
        return fail('DATE', 'Use a valid calendar date in YYYY-MM-DD format.');
    } else if (
      (rule.type === 'text' && typeof value !== 'string') ||
      (rule.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) ||
      (rule.type === 'boolean' && typeof value !== 'boolean')
    )
      return fail('TYPE', `Expected a ${rule.type} value.`);
    if (rule.type === 'text' && typeof value === 'string') {
      if (rule.allowedValues && !rule.allowedValues.includes(value))
        return fail('ALLOWED_VALUES', 'Value is not in the configured allowed values.');
      if (rule.minLength !== undefined && value.length < rule.minLength)
        return fail('MIN_LENGTH', 'Text is shorter than the configured minimum length.');
      if (rule.maxLength !== undefined && value.length > rule.maxLength)
        return fail('MAX_LENGTH', 'Text exceeds the configured maximum length.');
    }
    if (rule.type === 'number' && typeof value === 'number') {
      if (rule.minimum !== undefined && value < rule.minimum)
        return fail('MINIMUM', 'Number is below the configured minimum.');
      if (rule.maximum !== undefined && value > rule.maximum)
        return fail('MAXIMUM', 'Number exceeds the configured maximum.');
    }
    return { ...base, status: 'PASSED', message: 'Field matches its configured rules.' };
  });
}
