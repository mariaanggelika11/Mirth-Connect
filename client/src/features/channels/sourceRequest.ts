import type { Channel } from '../../types';

export function sourceRequest(channel: Pick<Channel, 'id' | 'name' | 'source'>) {
  const endpoint = channel.source.endpoint || '';
  const format = channel.source.inboundDataType || 'HL7V2';
  const contentType =
    format === 'JSON' ? 'application/json' : format === 'XML' ? 'application/xml' : 'text/plain';
  const body =
    format === 'JSON'
      ? JSON.stringify({ message: 'Synthetic connection test' }, null, 2)
      : format === 'XML'
        ? '<message>Synthetic connection test</message>'
        : format === 'HL7V2'
          ? 'MSH|^~\\&|SYNTHETIC|TEST|RECEIVER|TEST|20261016000000||ADT^A01|SYNTHETIC-001|P|2.5\rPID|1||SYNTHETIC-001^^^TEST^MR||TEST^SYNTHETIC\r'
          : 'Synthetic connection test';
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  return {
    endpoint,
    curl: [
      `curl --request POST ${quote(endpoint)}`,
      `--header ${quote('Content-Type: ' + contentType)}`,
      `--header ${quote('X-API-Key: <SOURCE_API_KEY>')}`,
      `--header ${quote('Idempotency-Key: <UNIQUE_REQUEST_ID>')}`,
      `--data-binary ${quote(body)}`,
    ].join(' \\\n  '),
    postman: JSON.stringify(
      {
        info: {
          name: channel.name + ' — synthetic inbound test',
          schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        variable: [
          { key: 'source_api_key', value: '<SOURCE_API_KEY>', type: 'string' },
          { key: 'idempotency_key', value: '<UNIQUE_REQUEST_ID>', type: 'string' },
        ],
        item: [
          {
            name: 'Send synthetic message',
            request: {
              method: 'POST',
              header: [
                { key: 'Content-Type', value: contentType },
                { key: 'X-API-Key', value: '{{source_api_key}}' },
                { key: 'Idempotency-Key', value: '{{idempotency_key}}' },
              ],
              url: endpoint,
              body: { mode: 'raw', raw: body },
            },
          },
        ],
      },
      null,
      2,
    ),
  };
}
