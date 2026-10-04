import { Channel, ChannelFormData, DataType } from '../types';
export function channelConfiguration(channel: Channel): ChannelFormData {
  return {
    name: channel.name,
    source: {
      type: channel.source.type,
      inboundDataType: channel.source.inboundDataType || DataType.HL7V2,
    },
    processingScript: channel.processingScript || '',
    responseScript: channel.responseScript || '',
    filterScript: channel.filterScript || '',
    destinations: channel.destinations.map((d) => ({
      name: d.name,
      type: d.type,
      endpoint: d.endpoint,
      outboundDataType: d.outboundDataType || DataType.HL7V2,
      processingScript: d.processingScript || '',
      responseScript: d.responseScript || '',
      templateScript: d.templateScript || '',
      filterScript: d.filterScript || '',
      isEnabled: d.isEnabled !== false,
      retryEnabled: !!d.retryEnabled,
      maxRetries: d.maxRetries ?? 3,
      retryIntervalSeconds: d.retryIntervalSeconds ?? 30,
      timeoutMs: d.timeoutMs ?? 10000,
    })),
  };
}
export function exportChannelXml(channel: Channel): string {
  const data = channelConfiguration(channel);
  const escape = (value: unknown) =>
    String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;');
  const tag = (key: string, value: unknown) => `<${key}>${escape(value)}</${key}>`;
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<channel>\n' +
    tag('name', data.name) +
    '\n<source>' +
    tag('type', data.source.type) +
    tag('inboundDataType', data.source.inboundDataType) +
    '</source>\n' +
    ['processingScript', 'responseScript', 'filterScript']
      .map((k) => tag(k, data[k as keyof ChannelFormData] || ''))
      .join('\n') +
    '\n<destinations>' +
    data.destinations
      .map(
        (d) =>
          '<destination>' +
          Object.entries(d)
            .map(([k, v]) => tag(k, v))
            .join('') +
          '</destination>',
      )
      .join('\n') +
    '</destinations>\n</channel>\n'
  );
}
export function downloadChannelXml(channel: Channel) {
  const url = URL.createObjectURL(
    new Blob([exportChannelXml(channel)], { type: 'application/xml' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = channel.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) + '.xml';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
