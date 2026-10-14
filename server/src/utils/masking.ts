import { config } from '../config/env.js';
// UI/support redaction is independent of transport payloads. Raw delivery data is never modified.
const sensitive =
  /^(?:name|patientName|patient|patientId|mrn|medicalRecordNumber|password|token|apiKey|authorization|secret|access_token|refresh_token)$/i;
export function maskPayload(value: unknown, path = ''): unknown {
  if (Array.isArray(value))
    return value.map((v, i) => maskPayload(v, path ? path + '.' + i : String(i)));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        sensitive.test(key) ||
        config.masking.jsonPaths.some((rule) => {
          const parts = rule.replace(/^\$\./, '').split('.');
          const actual = (path ? path + '.' + key : key).split('.');
          return (
            parts.length === actual.length &&
            parts.every((part, i) => part === '*' || part === actual[i])
          );
        })
          ? '[REDACTED]'
          : maskPayload(v, path ? path + '.' + key : key),
      ]),
    );
  if (typeof value === 'string') {
    if (value.startsWith('MSH') && value.length > 4) {
      const separator = value[3];
      return value
        .split(/\r\n|\r|\n/)
        .map((line) => {
          const fields = line.split(separator);
          for (const rule of config.masking.hl7Paths) {
            const [segment, field] = rule.split('.');
            if (fields[0] === segment && fields[Number(field)])
              fields[Number(field)] = '[REDACTED]';
          }
          return fields.join(separator);
        })
        .join('\r');
    }
    try {
      return maskPayload(JSON.parse(value));
    } catch {
      return value ? '[REDACTED TEXT]' : value;
    }
  }
  return value;
}
const metadataKeys = new Set([
  'requestId',
  'messageId',
  'channelId',
  'destinationId',
  'status',
  'method',
  'code',
  'errorCode',
  'port',
  'cause',
  'stage',
  'severity',
  'event',
  'count',
  'revision',
]);
export function safeLogRecord(input: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input))
    if (metadataKeys.has(key)) {
      if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
      else if (typeof value === 'string' && /^[A-Za-z0-9_:.-]{1,100}$/.test(value))
        result[key] = value;
    }
  return result;
}
