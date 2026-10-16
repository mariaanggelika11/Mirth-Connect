import { expect, it } from 'vitest';
import { exportChannelXml } from '../src/services/channel.config';
import { ChannelStatus, DataType, DestinationType } from '../src/types';
import { compileFieldMapping, readFieldMapping } from '../../server/src/utils/fieldMapping';
import { importChannelXml } from '../../server/src/services/xmlLoader.services';

it('round trips visual mappings through the existing channel export/import with advanced routing intact', async () => {
  const mapping = {
    version: 1 as const,
    rootElement: 'Patient',
    rows: [
      {
        source: 'patient_id',
        target: 'PatientID',
        required: false,
        defaultValue: 'Synthetic <empty> & unknown',
      },
    ],
  };
  const script = compileFieldMapping(mapping);
  const exported = exportChannelXml({
    id: 99,
    name: 'Synthetic mapping export',
    status: ChannelStatus.RUNNING,
    source: { type: 'HTTP', inboundDataType: DataType.JSON },
    idempotencyMode: 'REQUIRED',
    validationProfile: { jsonSchema: { type: 'object' } },
    processingScript: script,
    filterScript: 'return true;',
    responseScript: 'return response;',
    destinations: [
      {
        id: 7,
        name: 'XML destination',
        type: DestinationType.REST,
        endpoint: 'https://receiver.example.test/xml',
        outboundDataType: DataType.XML,
        retryEnabled: true,
        maxRetries: 4,
        timeoutMs: 12345,
        filterScript: 'return Boolean(msg.Patient);',
      },
      {
        id: 8,
        name: 'Conditional JSON route',
        type: DestinationType.REST,
        endpoint: 'https://receiver.example.test/json',
        outboundDataType: DataType.JSON,
        filterScript: 'return false;',
        processingScript: 'return msg;',
        responseScript: 'return response;',
      },
    ],
  });
  const imported = await importChannelXml(exported);
  expect(readFieldMapping(imported.processingScript)).toEqual(mapping);
  expect(imported.processingScript).toBe(script);
  expect(imported.idempotencyMode).toBe('REQUIRED');
  expect(imported.validationProfile).toEqual({ jsonSchema: { type: 'object' } });
  expect(imported.destinations[0]).toMatchObject({
    outboundDataType: 'XML',
    retryEnabled: true,
    maxRetries: 4,
    timeoutMs: 12345,
  });
  expect(imported.destinations[1]).toMatchObject({
    outboundDataType: 'JSON',
    filterScript: 'return false;',
    processingScript: 'return msg;',
    responseScript: 'return response;',
  });
  expect(exported).not.toContain('<id>');
});
