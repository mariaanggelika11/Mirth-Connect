import { parseSegments } from '../utils/hl7Converer.js';
import { parseField, FieldValue } from '../utils/hl7Fields.js';
export interface HL7Node {
  id: string;
  name: string;
  value?: string;
  path: string;
  children?: HL7Node[];
}
function fieldTree(value: FieldValue, id: string, name: string, path: string): HL7Node {
  if (typeof value === 'string') return { id, name, path, value };
  return {
    id,
    name,
    path,
    children: Object.entries(value).map(([key, v]) =>
      fieldTree(
        v,
        id + '.' + key,
        name + '.' + (Array.isArray(value) ? 'rep' + (Number(key) + 1) : key),
        path + (Array.isArray(value) ? `[${key}]` : `['${key}']`),
      ),
    ),
  };
}
export function parseHL7ToTree(message: string): HL7Node[] {
  const { delimiters: d, segments } = parseSegments(message);
  const counts: Record<string, number> = {};
  const totals: Record<string, number> = {};
  for (const s of segments) totals[s.name] = (totals[s.name] || 0) + 1;
  return segments.map((s) => {
    const occurrence = counts[s.name] || 0;
    counts[s.name] = occurrence + 1;
    const base = `msg['${s.name}']${totals[s.name] > 1 ? `[${occurrence}]` : ''}`;
    return {
      id: `${s.name}-${occurrence}`,
      name: s.name,
      path: base,
      children: s.fields
        .slice(1)
        .map((v, i) =>
          fieldTree(
            s.name === 'MSH' && i < 2 ? v : parseField(v, d),
            `${s.name}-${occurrence}.${i + 1}`,
            `${s.name}.${i + 1}`,
            base + `['${i + 1}']`,
          ),
        ),
    };
  });
}
