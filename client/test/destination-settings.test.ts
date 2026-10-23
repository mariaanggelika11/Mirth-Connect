import { describe, expect, it } from 'vitest';
import {
  destinationDeliveryCustomized,
  destinationDeliveryIssues,
  destinationHttpCustomized,
  destinationHttpIssues,
} from '../src/features/channels/destinationSettings';
import { newDestination } from '../src/features/channels/channelDraft';
import { httpSettingsError, type HttpSettings } from '../../server/src/utils/httpSettings';
import { channelSchema } from '../../server/src/utils/validator';

describe('Destination presentation preserves backend HTTP validation', () => {
  it('keeps empty optional headers and default values inactive', () => {
    expect(destinationHttpIssues({}, 'JSON').first).toBe('');
    expect(destinationHttpIssues({ headers: [] }, 'XML').first).toBe('');
    expect(
      destinationHttpCustomized(
        { method: 'POST', authentication: 'NONE', headers: [], contentType: 'application/json' },
        'JSON',
      ),
    ).toBe(false);
    expect(
      destinationDeliveryCustomized({
        ...newDestination(),
        maxRetries: 0,
        retryIntervalSeconds: 60,
        deliveryPolicy: { http: { method: 'POST' } },
      }),
    ).toBe(false);
  });
  it.each([
    { headers: [{ name: '', slot: 'VENDOR_KEY' }] },
    { headers: [{ name: 'X-Vendor-Key', slot: 'lower_case' }] },
    { headers: [{ name: 'Authorization', slot: 'VENDOR_KEY' }] },
    {
      headers: [
        { name: 'X-Key', slot: 'ONE' },
        { name: 'x-key', slot: 'TWO' },
      ],
    },
    { headers: [{ name: 'X-Internal', slot: '' }] },
    { headers: [{ name: 'X-Injected\r\nOther', slot: 'SAFE' }] },
  ] satisfies HttpSettings[])(
    'rejects the same unsafe header as the shared contract: %j',
    (http) => {
      expect(httpSettingsError(http)).not.toBe('');
      expect(destinationHttpIssues(http, 'JSON').first).not.toBe('');
    },
  );
  it('keeps stored security checks separate from the remaining Content-Type control', () => {
    const issue = destinationHttpIssues({ headers: [{ name: 'X-Key', slot: 'lower' }] }, 'JSON');
    expect(issue.contentType).toBe('');
    expect(issue.security).toContain('uppercase');
    expect(destinationHttpIssues({ contentType: 'text/xml' }, 'JSON').first).toBe(
      'Select a supported Content-Type.',
    );
  });
  it('recognizes real overrides without changing them', () => {
    const http: HttpSettings = {
      method: 'PATCH',
      authentication: 'BEARER',
      headers: [{ name: 'X-Key', slot: 'VENDOR_KEY' }],
    };
    expect(destinationHttpIssues(http, 'XML').first).toBe('');
    expect(destinationDeliveryCustomized({ ...newDestination(), deliveryPolicy: { http } })).toBe(
      true,
    );
    expect(destinationHttpCustomized(http, 'XML')).toBe(true);
    expect(http.method).toBe('PATCH');
  });
  it.each([
    { timeoutMs: 99 },
    { timeoutMs: 120001 },
    { timeoutMs: 100 },
    { maxRetries: 11 },
    { maxRetries: 1.5 },
    { maxRetries: 0 },
    { retryIntervalSeconds: 0 },
    { retryIntervalSeconds: 86400 },
    { deliveryPolicy: { failureThreshold: 0 } },
    { deliveryPolicy: { openSeconds: 3601 } },
    { deliveryPolicy: { maxConcurrency: 100 } },
  ])('keeps inline delivery limits consistent with API validation: %j', (changes) => {
    const dest = {
      ...newDestination(),
      name: 'Synthetic receiver',
      endpoint: 'https://receiver.example.test/messages',
      ...changes,
    };
    const valid = channelSchema.safeParse({
      name: 'Synthetic channel',
      source: { type: 'HTTP', inboundDataType: 'JSON' },
      destinations: [dest],
    }).success;
    expect(!Object.keys(destinationDeliveryIssues(dest)).length).toBe(valid);
  });
});
