// Pure helpers also run inside QuickJS. Preserve HL7 escapes; decode only on explicit request.
export interface Encoding {
  component: string;
  repetition: string;
  escape: string;
  subcomponent: string;
  field: string;
}
export type FieldValue = string | { [key: string]: FieldValue } | FieldValue[];
export function escapeField(value: string, d: Encoding): string {
  const codes: Record<string, string> = {
    [d.field]: 'F',
    [d.component]: 'S',
    [d.repetition]: 'R',
    [d.subcomponent]: 'T',
    [d.escape]: 'E',
  };
  let result = '';
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === d.escape) {
      const end = value.indexOf(d.escape, i + 1);
      const code = end < 0 ? '' : value.slice(i + 1, end);
      // Preserve existing encoded values from hl7ToJson; never preserve raw controls.
      if (
        /^(?:[FSRTEHN]|X(?:[0-9a-fA-F]{2})+|[CM][0-9a-fA-F]+|Z[^\x00-\x1f\x7f]*|\.[a-z]+(?: [0-9]+)?)$/.test(
          code,
        )
      ) {
        result += value.slice(i, end + 1);
        i = end;
        continue;
      }
    }
    const n = char.charCodeAt(0);
    result += codes[char]
      ? d.escape + codes[char] + d.escape
      : n < 32 || n === 127
        ? d.escape + 'X' + n.toString(16).toUpperCase().padStart(2, '0') + d.escape
        : char;
  }
  return result;
}
export function parseField(value: string, d: Encoding, level = 0): FieldValue {
  if (level === 0 && value.includes(d.repetition))
    return value.split(d.repetition).map((v) => parseField(v, d, 1));
  const separator = level <= 1 ? d.component : d.subcomponent;
  if (level > 2 || !value.includes(separator))
    return level <= 1 && value.includes(d.subcomponent) ? { '1': parseField(value, d, 2) } : value;
  return Object.fromEntries(
    value.split(separator).map((v, i) => [String(i + 1), parseField(v, d, level <= 1 ? 2 : 3)]),
  );
}
export function buildField(value: unknown, d: Encoding, level = 0): string {
  if (Array.isArray(value)) return value.map((v) => buildField(v, d, 1)).join(d.repetition);
  if (!value || typeof value !== 'object') return escapeField(String(value ?? ''), d);
  const record = value as Record<string, unknown>,
    keys = Object.keys(record).map(Number);
  if (keys.some((k) => !Number.isInteger(k) || k < 1 || k > 1000))
    throw new Error('INVALID_HL7_COMPONENT');
  return Array.from({ length: Math.max(0, ...keys) }, (_, i) =>
    buildField(record[String(i + 1)], d, level <= 1 ? 2 : 3),
  ).join(level <= 1 ? d.component : d.subcomponent);
}
export function decodeEscapes(value: string, d: Encoding): string {
  const codes: Record<string, string> = {
    F: d.field,
    S: d.component,
    R: d.repetition,
    T: d.subcomponent,
    E: d.escape,
  };
  const parts = value.split(d.escape);
  return parts.map((v, i) => (i % 2 === 1 ? (codes[v] ?? d.escape + v + d.escape) : v)).join('');
}
