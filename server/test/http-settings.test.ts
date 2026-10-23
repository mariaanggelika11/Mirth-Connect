import { describe, expect, it, vi } from 'vitest';
import { httpSettingsSchema } from '../src/utils/httpSettingsSchema.js';
import { destinationSchema } from '../src/utils/validator.js';
import { httpDeliveryConfiguration } from '../src/services/engine/httpConfiguration.js';
import type { Destination } from '../src/models/Destination.js';
const destination = { id: 83, outbound_data_type: 'HL7V2' } as Destination;
describe('HTTP settings reference only dedicated per-destination environment slots', () => {
  it('defaults to POST and format-correct Content-Type without a credential', () => {
    expect(httpDeliveryConfiguration(destination)).toEqual({
      method: 'POST',
      contentType: 'application/hl7-v2',
      headers: {},
    });
    expect(
      httpDeliveryConfiguration({ ...destination, outbound_data_type: 'TEXT' }).contentType,
    ).toBe('text/plain');
  });
  it('uses bearer/basic and custom header slots without persisting the secret values', () => {
    const env = {
      MIRTH_DESTINATION_83_BEARER_TOKEN: 'SYNTHETIC-TOKEN',
      MIRTH_DESTINATION_83_BASIC_USERNAME: 'SYNTHETIC-USER',
      MIRTH_DESTINATION_83_BASIC_PASSWORD: 'SYNTHETIC-PASSWORD',
      MIRTH_DESTINATION_83_VENDOR_KEY: 'SYNTHETIC-KEY',
    };
    Object.assign(process.env, env);
    try {
      const policy = {
        http: {
          method: 'PUT' as const,
          contentType: 'text/plain' as const,
          authentication: 'BEARER' as const,
          headers: [{ name: 'X-Vendor-Key', slot: 'VENDOR_KEY' }],
        },
      };
      expect(httpDeliveryConfiguration({ ...destination, delivery_policy: policy })).toMatchObject({
        method: 'PUT',
        contentType: 'text/plain',
        headers: { Authorization: 'Bearer SYNTHETIC-TOKEN', 'X-Vendor-Key': 'SYNTHETIC-KEY' },
      });
      expect(JSON.stringify(policy)).not.toMatch(/SYNTHETIC-TOKEN|SYNTHETIC-KEY/);
      expect(
        httpDeliveryConfiguration({
          ...destination,
          delivery_policy: { http: { authentication: 'BASIC' } },
        }).headers.Authorization,
      ).toBe('Basic ' + Buffer.from('SYNTHETIC-USER:SYNTHETIC-PASSWORD').toString('base64'));
      expect(() =>
        httpDeliveryConfiguration({ ...destination, id: 84, delivery_policy: policy }),
      ).toThrow('Configure the destination credential');
    } finally {
      for (const name of Object.keys(env)) delete process.env[name];
    }
  });
  it('rejects missing or newline credentials safely and never reads arbitrary server variables', () => {
    process.env.MIRTH_DESTINATION_83_SECRET = 'SYNTHETIC\r\nHeader: injection';
    try {
      expect(() =>
        httpDeliveryConfiguration({
          ...destination,
          delivery_policy: { http: { headers: [{ name: 'X-Vendor-Key', slot: 'SECRET' }] } },
        }),
      ).toThrow('Configure the destination credential');
      expect(
        httpSettingsSchema.safeParse({ headers: [{ name: 'X-Key', slot: '../../JWT_SECRET' }] })
          .success,
      ).toBe(false);
    } finally {
      delete process.env.MIRTH_DESTINATION_83_SECRET;
    }
  });
  it.each([
    ['BEARER', 'control', 'synthetic\u0001value'],
    ['BEARER', 'DEL', 'synthetic\u007fvalue'],
    ['BEARER', 'non-Latin', 'synthetic\u0100value'],
    ['CUSTOM', 'control', 'synthetic\u0001value'],
    ['CUSTOM', 'DEL', 'synthetic\u007fvalue'],
    ['CUSTOM', 'non-Latin', 'synthetic\u0100value'],
  ])(
    'rejects %s %s header characters before transport without returning the value',
    (mode, _, value) => {
      vi.stubEnv('MIRTH_DESTINATION_83_BEARER_TOKEN', value);
      vi.stubEnv('MIRTH_DESTINATION_83_VENDOR_KEY', value);
      try {
        const policy: NonNullable<Destination['delivery_policy']> = {
          http:
            mode === 'BEARER'
              ? { authentication: 'BEARER' }
              : { headers: [{ name: 'X-Vendor-Key', slot: 'VENDOR_KEY' }] },
        };
        expect(() =>
          httpDeliveryConfiguration({ ...destination, delivery_policy: policy }),
        ).toThrowError(
          expect.objectContaining({
            code: 'DESTINATION_CREDENTIAL_MISSING',
            message:
              'Configure the destination credential environment variables and restart the service.',
          }),
        );
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );
  it('encodes UTF-8 Basic credentials before checking the final HTTP header', () => {
    const username = 'synthetic-ユーザー';
    const password = 'synthetic-密碼';
    vi.stubEnv('MIRTH_DESTINATION_83_BASIC_USERNAME', username);
    vi.stubEnv('MIRTH_DESTINATION_83_BASIC_PASSWORD', password);
    try {
      const headers = httpDeliveryConfiguration({
        ...destination,
        delivery_policy: { http: { authentication: 'BASIC' } },
      }).headers;
      expect(headers.Authorization).toBe(
        'Basic ' + Buffer.from(username + ':' + password, 'utf8').toString('base64'),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it.each([
    'Host',
    'Authorization',
    'Cookie',
    'Content-Length',
    'Transfer-Encoding',
    'X-Correlation-Id',
    'Idempotency-Key',
  ])('rejects managed header override %s', (name) => {
    expect(httpSettingsSchema.safeParse({ headers: [{ name, slot: 'TEST' }] }).success).toBe(false);
  });
  it('rejects duplicates unsupported methods plaintext settings and incompatible content types', () => {
    for (const value of [
      { method: 'GET' },
      { token: 'SYNTHETIC-PRIVATE' },
      {
        headers: [
          { name: 'X-Key', slot: 'A' },
          { name: 'x-key', slot: 'B' },
        ],
      },
    ])
      expect(httpSettingsSchema.safeParse(value).success).toBe(false);
    expect(
      destinationSchema.safeParse({
        name: 'Synthetic',
        type: 'REST',
        endpoint: 'http://127.0.0.1:9100',
        outboundDataType: 'JSON',
        deliveryPolicy: { http: { contentType: 'text/plain' } },
      }).success,
    ).toBe(false);
  });
});
