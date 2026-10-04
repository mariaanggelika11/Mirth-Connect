import { parseStringPromise } from 'xml2js';
import { channelSchema } from '../utils/validator.js';
import { AppError } from '../utils/errors.js';
export async function importChannelXml(xml: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new AppError(400, 'XML_ENTITIES_DENIED', 'XML entity declarations are not supported');
  let parsed: Record<string, unknown>;
  try {
    parsed = await parseStringPromise(xml, {
      explicitArray: false,
      trim: true,
      explicitRoot: true,
    });
  } catch {
    throw new AppError(400, 'INVALID_XML', 'Invalid XML document');
  }
  const root = parsed.channel;
  if (!root || typeof root !== 'object' || Array.isArray(root))
    throw new AppError(400, 'INVALID_CHANNEL_XML', 'Expected one Mini Mirth channel document');
  const input = root as Record<string, unknown>;
  const allowed = [
    'name',
    'source',
    'destinations',
    'filterScript',
    'processingScript',
    'responseScript',
  ];
  if (Object.keys(input).some((k) => !allowed.includes(k)))
    throw new AppError(
      400,
      'UNSUPPORTED_CHANNEL_XML',
      'This export contains unsupported fields; use the documented Mini Mirth XML format',
    );
  const source = input.source as Record<string, unknown>;
  const container = input.destinations as Record<string, unknown>;
  const items = container?.destination
    ? Array.isArray(container.destination)
      ? container.destination
      : [container.destination]
    : [];
  const destinations = items.map((value: unknown) => {
    if (!value || typeof value !== 'object')
      throw new AppError(400, 'INVALID_CHANNEL_XML', 'Invalid destination');
    const d = { ...value } as Record<string, unknown>;
    const keys = [
      'name',
      'type',
      'endpoint',
      'outboundDataType',
      'filterScript',
      'processingScript',
      'responseScript',
      'templateScript',
      'isEnabled',
      'retryEnabled',
      'maxRetries',
      'retryIntervalSeconds',
      'timeoutMs',
    ];
    if (Object.keys(d).some((k) => !keys.includes(k)))
      throw new AppError(400, 'UNSUPPORTED_CHANNEL_XML', 'Unsupported destination field');
    for (const key of ['maxRetries', 'retryIntervalSeconds', 'timeoutMs'])
      if (d[key] !== undefined) d[key] = Number(d[key]);
    for (const key of ['isEnabled', 'retryEnabled'])
      if (d[key] !== undefined) {
        if (!['true', 'false'].includes(String(d[key])))
          throw new AppError(400, 'INVALID_CHANNEL_XML', 'Invalid boolean');
        d[key] = d[key] === 'true';
      }
    return d;
  });
  const result = channelSchema.safeParse({ ...input, source, destinations });
  if (!result.success)
    throw new AppError(400, 'INVALID_CHANNEL_XML', 'Invalid channel configuration in XML');
  return result.data;
}
