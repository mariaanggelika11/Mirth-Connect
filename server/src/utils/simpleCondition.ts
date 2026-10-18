/** Simple filters compile into the existing sandboxed filter stage. */
export type SimpleConditionOperator =
  | 'isEmpty'
  | 'isNotEmpty'
  | 'eq'
  | 'neq'
  | 'contains'
  | 'startsWith'
  | 'exists'
  | 'notExists'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte';

export interface SimpleConditionConfig {
  version: 1;
  field: string;
  operator: SimpleConditionOperator;
  value?: string;
}

const marker = '/* MIRTH_SIMPLE_CONDITION_V1:';
const operators = new Set<string>([
  'isEmpty',
  'isNotEmpty',
  'eq',
  'neq',
  'contains',
  'startsWith',
  'exists',
  'notExists',
  'gt',
  'gte',
  'lt',
  'lte',
]);
const forbiddenParts = new Set(['__proto__', 'prototype', 'constructor']);

export function validateSimpleCondition(input: unknown): SimpleConditionConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid filter condition.');
  const value = input as Record<string, unknown>;
  if (
    value.version !== 1 ||
    Object.keys(value).some((key) => !['version', 'field', 'operator', 'value'].includes(key)) ||
    typeof value.field !== 'string' ||
    typeof value.operator !== 'string' ||
    !operators.has(value.operator)
  )
    throw new Error('Invalid filter condition.');
  const field = value.field.trim();
  const parts = field.split('.');
  if (
    field.length > 256 ||
    parts.length > 12 ||
    parts.some(
      (part) =>
        !/^(?:[A-Za-z_$][A-Za-z0-9_$-]{0,63}|0|[1-9][0-9]{0,5})$/.test(part) ||
        forbiddenParts.has(part),
    )
  )
    throw new Error('Enter a valid filter field path.');
  const condition: SimpleConditionConfig = {
    version: 1,
    field,
    operator: value.operator as SimpleConditionOperator,
  };
  if (['exists', 'notExists', 'isEmpty', 'isNotEmpty'].includes(condition.operator))
    return condition;
  if (typeof value.value !== 'string' || value.value.length > 1024)
    throw new Error('Enter a filter value of at most 1024 characters.');
  if (
    ['gt', 'gte', 'lt', 'lte'].includes(condition.operator) &&
    (!value.value.trim() || !Number.isFinite(Number(value.value)))
  )
    throw new Error('Enter a finite number for this filter operator.');
  condition.value = value.value;
  return condition;
}

// Runs entirely inside QuickJS; field/value strings are data, never executable expressions.
const conditionBody = `
var conditionInput = msg;
if (typeof conditionInput === 'string') {
  var conditionText = conditionInput.trim();
  if (conditionText.startsWith('MSH')) conditionInput = hl7ToJson(conditionText);
  else {
    try { conditionInput = JSON.parse(conditionText); }
    catch (_) { throw new Error('FILTER_INPUT_INVALID'); }
  }
}
var conditionValue = conditionInput;
var conditionExists = true;
var conditionParts = conditionConfig.field.split('.');
for (var conditionIndex = 0; conditionIndex < conditionParts.length; conditionIndex++) {
  if (conditionValue === null || typeof conditionValue !== 'object' ||
      !Object.prototype.hasOwnProperty.call(conditionValue, conditionParts[conditionIndex])) {
    conditionExists = false;
    break;
  }
  conditionValue = conditionValue[conditionParts[conditionIndex]];
}
if (conditionConfig.operator === 'exists') return conditionExists;
if (conditionConfig.operator === 'notExists') return !conditionExists;
if (!conditionExists || conditionValue === null ||
    !['string', 'number', 'boolean'].includes(typeof conditionValue) ||
    (typeof conditionValue === 'number' && !Number.isFinite(conditionValue))) return false;
var conditionScalar = String(conditionValue);
if (conditionConfig.operator === 'eq') return conditionScalar === conditionConfig.value;
if (conditionConfig.operator === 'neq') return conditionScalar !== conditionConfig.value;
if (conditionConfig.operator === 'contains') return conditionScalar.includes(conditionConfig.value);
if (conditionConfig.operator === 'startsWith') return conditionScalar.startsWith(conditionConfig.value);
if (typeof conditionValue === 'boolean' ||
    (typeof conditionValue === 'string' && !conditionValue.trim())) return false;
var conditionNumber = Number(conditionValue);
if (!Number.isFinite(conditionNumber)) return false;
var conditionExpected = Number(conditionConfig.value);
if (conditionConfig.operator === 'gt') return conditionNumber > conditionExpected;
if (conditionConfig.operator === 'gte') return conditionNumber >= conditionExpected;
if (conditionConfig.operator === 'lt') return conditionNumber < conditionExpected;
if (conditionConfig.operator === 'lte') return conditionNumber <= conditionExpected;
return false;`;

export function compileSimpleCondition(input: SimpleConditionConfig): string {
  const condition = validateSimpleCondition(input);
  const empty = ['isEmpty', 'isNotEmpty'].includes(condition.operator);
  // Preserve V1 bytes so existing saved JSON/XML/HL7 filters still reopen and normalize correctly.
  const body = empty
    ? conditionBody.replace(
        "if (conditionConfig.operator === 'exists')",
        "if (conditionConfig.operator === 'isEmpty') return !conditionExists || conditionValue === null || conditionValue === '';\nif (conditionConfig.operator === 'isNotEmpty') return conditionExists && conditionValue !== null && conditionValue !== '' && ['string', 'number', 'boolean'].includes(typeof conditionValue);\nif (conditionConfig.operator === 'exists')",
      )
    : conditionBody;
  return `${marker}${encodeURIComponent(JSON.stringify(condition))} */\nvar conditionConfig = ${JSON.stringify(condition)};${body}`;
}

/** Only intact generated filters reopen as a builder; legacy scripts remain custom. */
export function readSimpleCondition(script: string): SimpleConditionConfig | null {
  if (script.length > 65536 || !script.startsWith(marker)) return null;
  const end = script.indexOf(' */\n', marker.length);
  if (end < 0) return null;
  try {
    const condition = validateSimpleCondition(
      JSON.parse(decodeURIComponent(script.slice(marker.length, end))),
    );
    return compileSimpleCondition(condition) === script ? condition : null;
  } catch {
    return null;
  }
}
