import type { Destination } from '../../types';
import {
  compatibleContentTypes,
  httpSettingsError,
  type HttpSettings,
} from '../../../../server/src/utils/httpSettings';

// Stored authentication and headers remain validated even though their editors are removed.
export function destinationHttpIssues(http: HttpSettings, format: string) {
  const contentType =
    http.contentType && !compatibleContentTypes(format).includes(http.contentType)
      ? 'Select a supported Content-Type.'
      : '';
  const method = httpSettingsError({ method: http.method });
  const security = httpSettingsError({
    authentication: http.authentication,
    headers: http.headers,
  });
  const general = httpSettingsError(http);
  return {
    contentType,
    method,
    security,
    general,
    first: contentType || method || security || general,
  };
}

export function destinationDeliveryCustomized(dest: Destination) {
  return (
    dest.isEnabled === false ||
    !!dest.retryEnabled ||
    (dest.timeoutMs !== undefined && dest.timeoutMs !== 10000) ||
    (['failureThreshold', 'openSeconds', 'maxConcurrency'] as const).some(
      (key) => dest.deliveryPolicy?.[key] !== undefined,
    ) ||
    (dest.type === 'REST' &&
      !!dest.deliveryPolicy?.http?.method &&
      dest.deliveryPolicy.http.method !== 'POST')
  );
}
export function destinationHttpCustomized(http: HttpSettings, format: string) {
  return (
    (!!http.authentication && http.authentication !== 'NONE') ||
    !!http.headers?.length ||
    (!!http.contentType && http.contentType !== compatibleContentTypes(format)[0])
  );
}

export function destinationDeliveryIssues(dest: Destination) {
  const issues: Record<string, string> = {};
  for (const [key, value, min, max, label] of [
    ['timeoutMs', dest.timeoutMs, 100, 120000, 'Use a timeout from 0.1 to 120 seconds.'],
    ['maxRetries', dest.maxRetries, 0, 10, 'Use 0 to 10 retry attempts.'],
    [
      'retryIntervalSeconds',
      dest.retryIntervalSeconds,
      1,
      86400,
      'Use a retry interval from 1 to 86400 seconds.',
    ],
    [
      'failureThreshold',
      dest.deliveryPolicy?.failureThreshold,
      1,
      100,
      'Use a failure threshold from 1 to 100.',
    ],
    [
      'openSeconds',
      dest.deliveryPolicy?.openSeconds,
      1,
      3600,
      'Use a circuit duration from 1 to 3600 seconds.',
    ],
    [
      'maxConcurrency',
      dest.deliveryPolicy?.maxConcurrency,
      1,
      100,
      'Use a concurrency limit from 1 to 100.',
    ],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < min || value > max))
      issues[key] = label;
  }
  return issues;
}
