import { validValidationFieldPath, type ValidationRuleResult } from './validationRules.js';
const prefix = 'VALIDATION_DETAILS_V1:';
const types = new Set(['text', 'number', 'boolean', 'date']);
const failureText: Record<string, string> = {
  REQUIRED: 'Required value is missing.',
  TYPE: 'Value has the wrong type.',
  DATE: 'Expected a valid date in YYYY-MM-DD format.',
  ALLOWED_VALUES: 'Value is not in the allowed list.',
  MIN_LENGTH: 'Text is shorter than the minimum length.',
  MAX_LENGTH: 'Text exceeds the maximum length.',
  MINIMUM: 'Number is below the minimum.',
  MAXIMUM: 'Number exceeds the maximum.',
};
/** Never copy exception/stored messages or values into user-visible diagnostics. */
export function safeValidationResults(input: unknown): ValidationRuleResult[] {
  if (!Array.isArray(input) || input.length > 50) return [];
  return input.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const r = item as Record<string, unknown>;
    if (
      !validValidationFieldPath(r.field) ||
      !types.has(String(r.type)) ||
      typeof r.required !== 'boolean' ||
      !['PASSED', 'FAILED', 'SKIPPED'].includes(String(r.status))
    )
      return [];
    if (
      r.status === 'FAILED' &&
      (typeof r.code !== 'string' || !Object.prototype.hasOwnProperty.call(failureText, r.code))
    )
      return [];
    const code = r.status === 'FAILED' ? String(r.code) : undefined;
    return [
      {
        field: r.field,
        type: r.type as ValidationRuleResult['type'],
        required: r.required,
        status: r.status as ValidationRuleResult['status'],
        ...(code ? { code } : {}),
        message: code
          ? code === 'TYPE'
            ? `Expected ${r.type === 'date' ? 'a date string in YYYY-MM-DD format' : r.type === 'number' ? 'a number' : r.type === 'boolean' ? 'a boolean' : 'text'}.`
            : failureText[code]
          : r.status === 'SKIPPED'
            ? 'Optional field is not present.'
            : 'Rule passed.',
      },
    ];
  });
}
export function persistValidationFailure(code: string, results: unknown): string {
  const failures = safeValidationResults(results).filter((r) => r.status === 'FAILED');
  return code === 'FIELD_VALIDATION_FAILED' && failures.length
    ? prefix + JSON.stringify({ code, results: failures })
    : code;
}
export function storedValidationFailure(
  value: unknown,
): { code: string; results: ValidationRuleResult[] } | undefined {
  if (typeof value !== 'string' || !value.startsWith(prefix) || value.length > 50000) return;
  try {
    const parsed = JSON.parse(value.slice(prefix.length));
    if (parsed.code !== 'FIELD_VALIDATION_FAILED') return;
    const results = safeValidationResults(parsed.results).filter((r) => r.status === 'FAILED');
    if (results.length) return { code: 'FIELD_VALIDATION_FAILED', results };
  } catch {
    /* Old/corrupt evidence is never interpreted as trusted diagnostic text. */
  }
}
export function messageErrorCode(value: string | undefined): string | undefined {
  if (!value) return value;
  if (value.startsWith(prefix)) return 'FIELD_VALIDATION_FAILED';
  return value;
}
