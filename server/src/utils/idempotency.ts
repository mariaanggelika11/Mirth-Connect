import { createHash } from 'node:crypto';
import { AppError } from './errors.js';
// SQL source fragment shared by on-request release and bounded maintenance. Keep ambiguous
// outcomes/active deliveries reserved, even after TTL, until operator reconciliation.
export const releasableReservation = `direction='IN' AND dedupe_expires_at<=CURRENT_TIMESTAMP
  AND status IN ('SUCCESS','FILTERED','RECEIVED','FAILED','PARTIAL','IN-ERROR')
  AND NOT EXISTS(SELECT 1 FROM "Messages" o WHERE o.inbound_message_id="Messages".id AND o.status IN ('PROCESSING','QUEUED','RETRYING','OUT-ERROR','DEAD_LETTER'))`;
// Sort object keys recursively, but retain array order and JSON's native value semantics.
// The original payload is stored/sent unchanged; canonicalization is only for identity.
export function canonicalJson(payload: unknown): string {
  const stack = [{ value: payload, depth: 0 }],
    seen = new WeakSet<object>();
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (depth > 100)
      throw new AppError(422, 'JSON_STRUCTURE_LIMIT', 'JSON structure exceeds depth limit');
    if (value && typeof value === 'object') {
      if (seen.has(value)) continue;
      seen.add(value);
      for (const child of Object.values(value)) stack.push({ value: child, depth: depth + 1 });
    }
  }
  const normalized = JSON.parse(JSON.stringify(payload));
  const encode = (value: unknown): string => {
    if (Array.isArray(value)) return '[' + value.map(encode).join(',') + ']';
    if (value && typeof value === 'object')
      return (
        '{' +
        Object.keys(value)
          .sort()
          .map((key) => JSON.stringify(key) + ':' + encode((value as Record<string, unknown>)[key]))
          .join(',') +
        '}'
      );
    return JSON.stringify(value);
  };
  return encode(normalized);
}
export function requestDigest(payload: unknown, isJson: boolean) {
  const encoded = isJson ? canonicalJson(payload) : JSON.stringify(payload ?? null);
  return createHash('sha256').update(encoded).digest('hex');
}
