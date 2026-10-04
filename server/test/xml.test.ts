import { it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { importChannelXml } from '../src/services/xmlLoader.services.js';
it('imports validated canonical channel XML with retry settings', async () => {
  const c = await importChannelXml(
    await readFile(new URL('../../docs/channel-example.xml', import.meta.url), 'utf8'),
  );
  expect(c.source.type).toBe('HTTP');
  expect(c.destinations[0].retryEnabled).toBe(true);
  expect(c.destinations[0].maxRetries).toBe(3);
});
it('rejects XML entity declarations', async () => {
  await expect(
    importChannelXml(
      '<!DOCTYPE channel [<!ENTITY x SYSTEM "file:///etc/passwd">]><channel>&x;</channel>',
    ),
  ).rejects.toThrow('entity declarations');
});
it('rejects unsupported native Mirth exports rather than silently losing fields', async () => {
  await expect(
    importChannelXml('<channel><sourceConnector>data</sourceConnector></channel>'),
  ).rejects.toThrow('unsupported fields');
});
it('rejects malformed XML', async () => {
  await expect(importChannelXml('<channel>')).rejects.toThrow();
});

it('round trips frontend XML export with scripts and escaped names but without IDs', async () => {
  const { exportChannelXml } = await import('../../client/src/services/channel.config');
  const { ChannelStatus, DestinationType, DataType } = await import('../../client/src/types');
  const xml = exportChannelXml({
    id: 10,
    name: 'HIS & Lab <results>',
    status: ChannelStatus.RUNNING,
    source: { type: 'HTTP', inboundDataType: DataType.JSON },
    processingScript: 'if (msg.x < 5 && msg.y) return msg;',
    destinations: [
      {
        id: 20,
        channel_id: 10,
        name: 'REST & test',
        type: DestinationType.REST,
        endpoint: 'https://api.example.com/results',
        outboundDataType: DataType.JSON,
        retryEnabled: true,
        maxRetries: 4,
      },
    ],
  });
  const parsed = await importChannelXml(xml);
  expect(parsed.name).toBe('HIS & Lab <results>');
  expect(parsed.processingScript).toBe('if (msg.x < 5 && msg.y) return msg;');
  expect(parsed.destinations[0].retryEnabled).toBe(true);
  expect(parsed.destinations[0].maxRetries).toBe(4);
  expect(xml).not.toContain('<id>');
  expect(xml).not.toContain('channel_id');
});
it('round trips an exported receive-only channel', async () => {
  const { exportChannelXml } = await import('../../client/src/services/channel.config');
  const { ChannelStatus } = await import('../../client/src/types');
  const data = await importChannelXml(
    exportChannelXml({
      id: 1,
      name: 'Receive only',
      status: ChannelStatus.STOPPED,
      source: { type: 'HTTP' },
      destinations: [],
    }),
  );
  expect(data.destinations).toEqual([]);
});
