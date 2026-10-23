export interface HttpSettings {
  method?: 'POST' | 'PUT' | 'PATCH';
  contentType?:
    'application/json' | 'application/xml' | 'text/xml' | 'application/hl7-v2' | 'text/plain';
  authentication?: 'NONE' | 'BEARER' | 'BASIC';
  headers?: { name: string; slot: string }[];
}
const reserved = new Set([
  'authorization',
  'host',
  'content-type',
  'content-length',
  'transfer-encoding',
  'connection',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'proxy-connection',
  'upgrade',
  'te',
  'trailer',
  'expect',
  'idempotency-key',
  'x-correlation-id',
  'x-channel-id',
  'x-destination-id',
]);
export function compatibleContentTypes(format: string): string[] {
  return format === 'XML'
    ? ['application/xml', 'text/xml']
    : format === 'HL7V2'
      ? ['application/hl7-v2', 'text/plain']
      : format === 'TEXT'
        ? ['text/plain']
        : ['application/json'];
}

/** One shared browser/server contract; environment values never enter this configuration. */
export function httpSettingsError(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return 'HTTP settings must be an object.';
  const settings = value as Record<string, unknown>;
  if (
    Object.keys(settings).some(
      (key) => !['method', 'contentType', 'authentication', 'headers'].includes(key),
    )
  )
    return 'Use only supported HTTP settings; credentials belong in destination environment variables.';
  if (
    settings.method !== undefined &&
    (typeof settings.method !== 'string' || !['POST', 'PUT', 'PATCH'].includes(settings.method))
  )
    return 'Choose POST, PUT or PATCH.';
  if (
    settings.contentType !== undefined &&
    (typeof settings.contentType !== 'string' ||
      ![
        'application/json',
        'application/xml',
        'text/xml',
        'application/hl7-v2',
        'text/plain',
      ].includes(settings.contentType))
  )
    return 'Choose a supported Content-Type.';
  if (
    settings.authentication !== undefined &&
    (typeof settings.authentication !== 'string' ||
      !['NONE', 'BEARER', 'BASIC'].includes(settings.authentication))
  )
    return 'Choose a supported authentication method.';
  if (settings.headers !== undefined) {
    if (!Array.isArray(settings.headers) || settings.headers.length > 10)
      return 'Use at most ten custom headers.';
    const names = new Set<string>();
    for (const row of settings.headers) {
      if (
        !row ||
        typeof row !== 'object' ||
        Array.isArray(row) ||
        Object.keys(row).some((key) => !['name', 'slot'].includes(key)) ||
        typeof row.name !== 'string' ||
        !/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(row.name) ||
        reserved.has(row.name.toLowerCase())
      )
        return 'Enter an unmanaged header name, such as X-Vendor-Key.';
      if (typeof row.slot !== 'string' || !/^[A-Z][A-Z0-9_]{0,39}$/.test(row.slot))
        return 'Use an uppercase credential slot, such as VENDOR_KEY.';
      if (names.has(row.name.toLowerCase())) return 'Header names must be unique.';
      names.add(row.name.toLowerCase());
    }
  }
  return '';
}
