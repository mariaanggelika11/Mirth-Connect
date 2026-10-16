import { describe, expect, it } from 'vitest';
import { automaticChangeSummary, configurationChangeActions } from '../src/utils/channelChanges.js';
import { channelSchema } from '../src/utils/validator.js';

const original = () =>
  channelSchema.parse({
    name: 'Synthetic channel',
    source: { type: 'HTTP', inboundDataType: 'JSON' },
    validationProfile: {
      jsonSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' } },
      },
    },
    destinations: [{ name: 'Synthetic receiver', type: 'REST', endpoint: 'http://localhost' }],
  });

describe('Automatic configuration change classification', () => {
  it('identifies source, transformation, destination and name independently', () => {
    const previous = original();
    for (const [change, expected] of [
      [{ source: { ...previous.source, inboundDataType: 'XML' } }, 'SOURCE_UPDATED'],
      [{ filterScript: 'return false;' }, 'SOURCE_UPDATED'],
      [{ responseScript: 'return "SYNTHETIC-PRIVATE";' }, 'SOURCE_UPDATED'],
      [{ idempotencyMode: 'REQUIRED' }, 'SOURCE_UPDATED'],
      [{ validationProfile: { basicSyntax: true } }, 'SOURCE_UPDATED'],
      [{ processingScript: 'msg.ID = msg.id;' }, 'TRANSFORMATION_UPDATED'],
      [{ destinations: [] }, 'DESTINATION_UPDATED'],
      [{ name: 'Renamed synthetic channel' }, 'CHANNEL_UPDATED'],
    ] as const)
      expect(
        configurationChangeActions(previous, channelSchema.parse({ ...previous, ...change })),
      ).toEqual([expected]);
    expect(
      configurationChangeActions(previous, {
        ...previous,
        name: 'Changed',
        processingScript: 'return msg;',
        filterScript: 'return true;',
        destinations: [],
      }),
    ).toEqual([
      'SOURCE_UPDATED',
      'TRANSFORMATION_UPDATED',
      'DESTINATION_UPDATED',
      'CHANNEL_UPDATED',
    ]);
  });

  it('ignores JSON object key order, optional summary and derived source endpoint', () => {
    const previous = original();
    const next = {
      ...previous,
      changeSummary: 'Synthetic administrative summary',
      source: {
        ...previous.source,
        endpoint: 'https://connect.example.test/api/message/inbound/1',
      },
      validationProfile: {
        jsonSchema: {
          properties: { name: { type: 'string' }, id: { type: 'string' } },
          type: 'object',
        },
      },
    };
    expect(configurationChangeActions(previous, next)).toEqual([]);
    expect(automaticChangeSummary([])).toBe('Configuration reviewed; no changes');
  });

  it('returns only safe action names and summaries when scripts or credentials change', () => {
    const previous = original();
    const actions = configurationChangeActions(previous, {
      ...previous,
      processingScript: 'msg.password = "SYNTHETIC-PRIVATE";',
      destinations: [{ ...previous.destinations[0], endpoint: 'http://user:secret@localhost' }],
    });
    expect(actions).toEqual(['TRANSFORMATION_UPDATED', 'DESTINATION_UPDATED']);
    expect(automaticChangeSummary(actions)).toBe('Updated transformation, destinations');
    expect(JSON.stringify({ actions, summary: automaticChangeSummary(actions) })).not.toContain(
      'secret',
    );
    expect(JSON.stringify(actions)).not.toContain('SYNTHETIC-PRIVATE');
  });
});
