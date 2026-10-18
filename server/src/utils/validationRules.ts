/** Shared, browser-safe configuration helpers. These never inspect or execute message payloads. */
export interface FieldRule {
  field: string;
  type: 'text' | 'number' | 'boolean' | 'date';
  required: boolean;
  allowedValues?: string[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}
export interface ValidationSettings {
  version: 1;
  mode: 'NONE' | 'FIELDS' | 'CUSTOM' | 'LEGACY';
  fieldRules: FieldRule[];
  custom: Record<string, unknown>;
  legacy?: Record<string, unknown>;
}
export interface ValidationRuleResult {
  field: string;
  type: FieldRule['type'];
  required: boolean;
  status: 'PASSED' | 'FAILED' | 'SKIPPED';
  code?: string;
  message: string;
}
export interface FieldRuleError {
  index: number;
  field?: string;
  message: string;
}
const own = (value: object, field: string) => Object.prototype.hasOwnProperty.call(value, field);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
export function validValidationFieldPath(field: unknown): field is string {
  if (typeof field !== 'string' || !field.length || field.length > 256) return false;
  const parts = field.split('.');
  return (
    parts.length <= 12 &&
    parts.every(
      (part) => !forbidden.has(part) && /^(?:[A-Za-z_][A-Za-z0-9_-]*|0|[1-9][0-9]*)$/.test(part),
    )
  );
}
export function readValidationSettings(profile: Record<string, unknown> = {}): ValidationSettings {
  if (
    profile.version === 1 &&
    ['NONE', 'FIELDS', 'CUSTOM', 'LEGACY'].includes(String(profile.mode))
  )
    return {
      version: 1,
      mode: profile.mode as ValidationSettings['mode'],
      fieldRules: Array.isArray(profile.fieldRules)
        ? (structuredClone(profile.fieldRules) as FieldRule[])
        : [],
      custom: record(profile.custom) ? structuredClone(profile.custom) : {},
      ...(record(profile.legacy) ? { legacy: structuredClone(profile.legacy) } : {}),
    };
  if (!Object.keys(profile).length) return { version: 1, mode: 'NONE', fieldRules: [], custom: {} };
  const basic = Object.keys(profile).length === 1 && profile.basicSyntax === true;
  const objectOnly =
    Object.keys(profile).length === 1 &&
    record(profile.jsonSchema) &&
    Object.keys(profile.jsonSchema).length === 1 &&
    profile.jsonSchema.type === 'object';
  return {
    version: 1,
    mode: basic || objectOnly ? 'LEGACY' : 'CUSTOM',
    fieldRules: [],
    custom: basic || objectOnly ? {} : structuredClone(profile),
    ...(basic || objectOnly ? { legacy: structuredClone(profile) } : {}),
  };
}
export function fieldRuleErrors(rules: unknown): FieldRuleError[] {
  if (!Array.isArray(rules) || !rules.length)
    return [{ index: -1, message: 'Add at least one field rule.' }];
  if (rules.length > 50) return [{ index: -1, message: 'Use at most 50 field rules.' }];
  const errors: FieldRuleError[] = [];
  const fields = new Set<string>();
  const keys = new Set([
    'field',
    'type',
    'required',
    'allowedValues',
    'minLength',
    'maxLength',
    'minimum',
    'maximum',
  ]);
  rules.forEach((rule: unknown, index) => {
    const field = record(rule) && validValidationFieldPath(rule.field) ? rule.field : undefined;
    const add = (message: string) => errors.push({ index, ...(field ? { field } : {}), message });
    if (!record(rule)) return void add('Each field rule must be an object.');
    if (Object.keys(rule).some((key) => !keys.has(key)))
      add('Remove unsupported field rule settings.');
    if (!field)
      add(
        'Use a field path of at most 256 characters and 12 parts, such as patient.id or patients.0.id.',
      );
    else if (fields.has(field)) add('Use one rule per field.');
    else fields.add(field);
    if (!['text', 'number', 'boolean', 'date'].includes(String(rule.type)))
      add('Select text, number, boolean or date.');
    if (typeof rule.required !== 'boolean') add('Choose whether the field is required.');
    if (own(rule, 'allowedValues')) {
      if (rule.type !== 'text') add('Allowed values are available for text fields only.');
      if (
        !Array.isArray(rule.allowedValues) ||
        !rule.allowedValues.length ||
        rule.allowedValues.length > 50 ||
        rule.allowedValues.some(
          (value: unknown) => typeof value !== 'string' || !value.length || value.length > 300,
        )
      )
        add('Use between 1 and 50 text values of 1 to 300 characters each.');
      else if (rule.allowedValues.some((value: string) => /[\r\n]/.test(value)))
        add('Allowed values must be single-line text without line breaks.');
    }
    for (const key of ['minLength', 'maxLength'] as const) {
      if (!own(rule, key)) continue;
      if (rule.type !== 'text') add('Length limits are available for text fields only.');
      if (
        typeof rule[key] !== 'number' ||
        !Number.isSafeInteger(rule[key]) ||
        rule[key] < 0 ||
        rule[key] > 1048576
      )
        add('Length limits must be whole numbers between 0 and 1048576.');
    }
    if (
      typeof rule.minLength === 'number' &&
      typeof rule.maxLength === 'number' &&
      rule.minLength > rule.maxLength
    )
      add('Minimum length cannot exceed maximum length.');
    for (const key of ['minimum', 'maximum'] as const) {
      if (!own(rule, key)) continue;
      if (rule.type !== 'number') add('Number limits are available for number fields only.');
      if (typeof rule[key] !== 'number' || !Number.isFinite(rule[key]))
        add('Number limits must be finite numbers.');
    }
    if (
      typeof rule.minimum === 'number' &&
      typeof rule.maximum === 'number' &&
      rule.minimum > rule.maximum
    )
      add('Minimum value cannot exceed maximum value.');
  });
  return errors;
}
