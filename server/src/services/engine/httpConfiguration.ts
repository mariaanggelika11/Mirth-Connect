import type { Destination } from '../../models/Destination.js';
import { compatibleContentTypes } from '../../utils/httpSettings.js';
import { httpSettingsSchema } from '../../utils/httpSettingsSchema.js';
import { AppError } from '../../utils/errors.js';
import { validateHeaderValue } from 'node:http';
export function httpDeliveryConfiguration(destination: Destination) {
  const parsed = httpSettingsSchema.safeParse(destination.delivery_policy?.http || {});
  if (!parsed.success)
    throw new AppError(422, 'HTTP_CONFIG_INVALID', 'Check the destination HTTP settings.');
  const settings = parsed.data;
  if (
    settings.contentType &&
    !compatibleContentTypes(destination.outbound_data_type).includes(settings.contentType)
  )
    throw new AppError(
      422,
      'HTTP_CONFIG_INVALID',
      'Content-Type does not match the destination output format.',
    );
  const headers: Record<string, string> = {};
  function credential(slot: string) {
    const value = process.env[`MIRTH_DESTINATION_${destination.id}_${slot}`];
    if (
      !Number.isSafeInteger(destination.id) ||
      destination.id < 1 ||
      !value ||
      value.length > 4096 ||
      /[\r\n\x00]/.test(value)
    )
      throw new AppError(
        422,
        'DESTINATION_CREDENTIAL_MISSING',
        'Configure the destination credential environment variables and restart the service.',
      );
    return value;
  }
  if (settings.authentication === 'BEARER')
    headers.Authorization = 'Bearer ' + credential('BEARER_TOKEN');
  if (settings.authentication === 'BASIC')
    headers.Authorization =
      'Basic ' +
      Buffer.from(credential('BASIC_USERNAME') + ':' + credential('BASIC_PASSWORD')).toString(
        'base64',
      );
  for (const header of settings.headers || []) headers[header.name] = credential(header.slot);
  // Validate the final wire value: Basic UTF-8 credentials are safe after Base64,
  // while Bearer/custom values must satisfy Node's HTTP header character rules.
  for (const [name, value] of Object.entries(headers)) {
    try {
      validateHeaderValue(name, value);
    } catch {
      throw new AppError(
        422,
        'DESTINATION_CREDENTIAL_MISSING',
        'Configure the destination credential environment variables and restart the service.',
      );
    }
  }
  return {
    method: settings.method || 'POST',
    contentType: settings.contentType || compatibleContentTypes(destination.outbound_data_type)[0],
    headers,
  };
}
