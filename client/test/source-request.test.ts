import { describe, expect, it } from 'vitest';
import { sourceRequest } from '../src/features/channels/sourceRequest';
import { DataType } from '../src/types';

describe('Synthetic source request exports', () => {
  it.each(['http://localhost:9000', 'https://connect.bulmar.tech'])(
    'uses the authoritative endpoint at %s',
    (base) => {
      const endpoint = base + '/api/message/inbound/42';
      const result = sourceRequest({
        id: 42,
        name: 'Synthetic',
        source: { type: 'HTTP', inboundDataType: DataType.JSON, endpoint },
      });
      const collection = JSON.parse(result.postman);
      expect(collection.item[0].request.url).toBe(endpoint);
      expect(result.curl).toContain(endpoint);
      expect(result.curl).toContain('X-API-Key: <SOURCE_API_KEY>');
      expect(result.curl).not.toContain('\n+');
      expect(collection.item[0].request.header).toContainEqual({
        key: 'X-API-Key',
        value: '{{source_api_key}}',
      });
      expect(collection.item[0].request.header).toContainEqual({
        key: 'Idempotency-Key',
        value: '{{idempotency_key}}',
      });
      expect(JSON.parse(collection.item[0].request.body.raw)).toEqual({
        message: 'Synthetic connection test',
      });
    },
  );
  it.each([
    [DataType.JSON, 'application/json', 'Synthetic connection test'],
    [DataType.XML, 'application/xml', '<message>'],
    [DataType.HL7V2, 'text/plain', 'MSH|^~\\&|'],
    [DataType.TEXT, 'text/plain', 'Synthetic connection test'],
  ])(
    'exports a synthetic %s request with its actual content type',
    (format, contentType, marker) => {
      const { postman } = sourceRequest({
        id: 1,
        name: 'Synthetic',
        source: {
          type: 'HTTP',
          inboundDataType: format as DataType,
          endpoint: 'https://connect.example.test/api/message/inbound/1',
        },
      });
      const request = JSON.parse(postman).item[0].request;
      expect(request.header[0]).toEqual({ key: 'Content-Type', value: contentType });
      expect(request.body.raw).toContain(marker);
    },
  );
});
