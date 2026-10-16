import { describe, expect, it } from 'vitest';
import { sourceRequest } from '../src/features/channels/sourceRequest';
import { DataType } from '../src/types';

describe('Synthetic source requests', () => {
  it.each([
    [DataType.JSON, 'application/json', 'Synthetic connection test'],
    [DataType.XML, 'application/xml', '<message>'],
    [DataType.HL7V2, 'text/plain', 'MSH|^~\\&|'],
    [DataType.TEXT, 'text/plain', 'Synthetic connection test'],
  ])(
    'builds a synthetic %s request with its actual content type',
    (format, contentType, marker) => {
      const request = sourceRequest({
        source: {
          type: 'HTTP',
          inboundDataType: format as DataType,
          endpoint: 'https://connect.example.test/api/message/inbound/1',
        },
      });
      expect(request.contentType).toBe(contentType);
      expect(request.body).toContain(marker);
      if (format === DataType.JSON)
        expect(JSON.parse(request.body)).toEqual({ message: 'Synthetic connection test' });
    },
  );
});
