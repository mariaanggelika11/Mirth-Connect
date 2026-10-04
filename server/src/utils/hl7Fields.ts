// Pure helpers also run inside QuickJS. Preserve HL7 escapes; decode only on explicit request.
export interface Encoding {
  component: string;
  repetition: string;
  escape: string;
  subcomponent: string;
  field: string;
}
export type FieldValue = string | { [key: string]: FieldValue } | FieldValue[];
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
  if (!value || typeof value !== 'object') return String(value ?? '');
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
