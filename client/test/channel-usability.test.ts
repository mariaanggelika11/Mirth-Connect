import { describe, expect, it } from 'vitest';
import {
  initialDraft,
  newDestination,
  selectedValidationProfile,
  validationChoice,
} from '../src/features/channels/channelDraft';
import { ChannelStatus, DataType, DestinationType, type Channel } from '../src/types';

describe('Progressive channel configuration', () => {
  it('starts a simple HTTP JSON channel without scripts or required custom validation', () => {
    const draft = initialDraft();
    expect(draft.source).toEqual({ type: 'HTTP', inboundDataType: DataType.JSON });
    expect(draft.idempotencyMode).toBe('OPTIONAL');
    expect(draft.validationProfile).toEqual({});
    expect(draft.processingScript).toBe('');
    expect(draft.filterScript).toBe('');
    expect(newDestination()).toMatchObject({
      type: DestinationType.REST,
      outboundDataType: DataType.JSON,
      retryEnabled: false,
      timeoutMs: 10000,
    });
  });

  it('preserves an existing channel profile, scripts, formats and delivery settings', () => {
    const profile = { hl7: { versions: ['2.5'], requiredFields: ['PID.3'] } };
    const channel: Channel = {
      id: 1,
      name: 'Existing HL7 integration',
      status: ChannelStatus.RUNNING,
      source: { type: 'HL7', inboundDataType: DataType.HL7V2 },
      idempotencyMode: 'REQUIRED',
      validationProfile: profile,
      processingScript: 'return hl7ToJson(msg);',
      filterScript: 'return Boolean(msg.PID);',
      responseScript: 'return response;',
      destinations: [
        {
          id: 9,
          name: 'Existing receiver',
          type: DestinationType.MLLP,
          endpoint: 'tls://integration.example.test:2575',
          outboundDataType: DataType.HL7V2,
          retryEnabled: true,
          maxRetries: 5,
          retryIntervalSeconds: 45,
          timeoutMs: 120000,
          processingScript: 'return msg;',
          templateScript: 'return msg;',
          responseScript: 'return response;',
          deliveryPolicy: { failureThreshold: 8, maxConcurrency: 2 },
        },
      ],
    };
    const draft = initialDraft(channel);
    expect(draft).toMatchObject({
      source: channel.source,
      validationProfile: profile,
      idempotencyMode: 'REQUIRED',
      processingScript: channel.processingScript,
      filterScript: channel.filterScript,
      responseScript: channel.responseScript,
      destinations: channel.destinations,
    });
    expect(validationChoice(profile)).toBe('CUSTOM');
    expect(draft.changeSummary).toBe('');
  });

  it('never treats an extended JSON validation profile as the basic preset', () => {
    expect(validationChoice({ basicSyntax: true })).toBe('BASIC');
    expect(validationChoice({ basicSyntax: false })).toBe('CUSTOM');
    expect(validationChoice({ basicSyntax: true, xml: { root: 'Patient' } })).toBe('CUSTOM');
    expect(validationChoice({ jsonSchema: { type: 'object' } })).toBe('BASIC_JSON');
    expect(validationChoice({ jsonSchema: { type: 'object', required: ['message'] } })).toBe(
      'CUSTOM',
    );
    expect(validationChoice({ jsonSchema: { type: 'object' }, script: 'return true;' })).toBe(
      'CUSTOM',
    );
    expect(validationChoice({ jsonSchema: null })).toBe('CUSTOM');
    expect(validationChoice()).toBe('NONE');
  });

  it('keeps legacy missing formats on their original HL7 defaults', () => {
    const draft = initialDraft({
      id: 2,
      name: 'Legacy defaults',
      status: ChannelStatus.STOPPED,
      source: { type: 'HTTP' },
      destinations: [
        {
          name: 'Legacy destination',
          type: DestinationType.REST,
          endpoint: 'http://receiver.example.test',
        },
      ],
    });
    expect(draft.source.inboundDataType).toBe(DataType.HL7V2);
    expect(draft.destinations[0].outboundDataType).toBe(DataType.HL7V2);
  });

  it('keeps custom profile text intact while users choose no additional or basic validation', () => {
    const customText = '{"jsonSchema":{"type":"object","required":["message"]}}';
    expect(selectedValidationProfile('NONE', customText)).toEqual({});
    expect(selectedValidationProfile('BASIC', customText)).toEqual({ basicSyntax: true });
    expect(selectedValidationProfile('BASIC_JSON', customText)).toEqual({
      jsonSchema: { type: 'object' },
    });
    const basicSyntax = selectedValidationProfile('BASIC', customText);
    basicSyntax.basicSyntax = false;
    expect(selectedValidationProfile('BASIC', customText)).toEqual({ basicSyntax: true });
    expect(selectedValidationProfile('CUSTOM', customText)).toEqual(JSON.parse(customText));
    const basic = selectedValidationProfile('BASIC_JSON', customText);
    (basic.jsonSchema as Record<string, unknown>).type = 'string';
    expect(selectedValidationProfile('BASIC_JSON', customText)).toEqual({
      jsonSchema: { type: 'object' },
    });
  });

  it('rejects malformed and non-object custom profiles before save or preview', () => {
    for (const text of ['{', 'null', '[]', '"schema"', '42']) {
      expect(() => selectedValidationProfile('CUSTOM', text)).toThrow();
    }
  });
});
