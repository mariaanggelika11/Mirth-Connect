import type { Channel } from '../../types';

export function sourceRequest(channel: Pick<Channel, 'source'>) {
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
  return { contentType, body };
}
