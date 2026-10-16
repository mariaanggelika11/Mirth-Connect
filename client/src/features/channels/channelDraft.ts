import { DataType, DestinationType } from '../../types';
import type { Channel, ChannelFormData, Destination } from '../../types';
export const newDestination = (): Destination => ({
  name: '',
  type: DestinationType.REST,
  endpoint: '',
  outboundDataType: DataType.JSON,
  isEnabled: true,
  retryEnabled: false,
  maxRetries: 3,
  retryIntervalSeconds: 30,
  timeoutMs: 10000,
  processingScript: '',
  responseScript: '',
  templateScript: '',
  filterScript: '',
});
export function initialDraft(channel?: Channel | null): ChannelFormData {
  return {
    name: channel?.name || '',
    validationProfile: channel?.validationProfile || {},
    idempotencyMode: channel?.idempotencyMode || 'OPTIONAL',
    changeSummary: '',
    source: {
      type: channel?.source.type === 'HL7' ? 'HL7' : 'HTTP',
      inboundDataType:
        channel?.source.inboundDataType || (channel ? DataType.HL7V2 : DataType.JSON),
    },
    processingScript: channel?.processingScript || '',
    filterScript: channel?.filterScript || '',
    responseScript: channel?.responseScript || '',
    destinations: channel
      ? channel.destinations.map((d) => ({
          ...newDestination(),
          ...d,
          outboundDataType: d.outboundDataType || DataType.HL7V2,
        }))
      : [newDestination()],
  };
}

export interface ChannelScriptEditor {
  destination?: number;
  field: 'processingScript' | 'responseScript' | 'templateScript';
  title: string;
}

export type MessageValidation = 'NONE' | 'BASIC' | 'BASIC_JSON' | 'CUSTOM';
export const basicJsonProfile = { jsonSchema: { type: 'object' } };
export function validationChoice(profile: Record<string, unknown> = {}): MessageValidation {
  if (!Object.keys(profile).length) return 'NONE';
  if (Object.keys(profile).length === 1 && profile.basicSyntax === true) return 'BASIC';
  const schema = profile.jsonSchema;
  return Object.keys(profile).length === 1 &&
    schema !== null &&
    typeof schema === 'object' &&
    Object.keys(schema).length === 1 &&
    (schema as Record<string, unknown>).type === 'object'
    ? 'BASIC_JSON'
    : 'CUSTOM';
}
export function selectedValidationProfile(
  choice: MessageValidation,
  customText: string,
): Record<string, unknown> {
  if (choice === 'NONE') return {};
  if (choice === 'BASIC') return { basicSyntax: true };
  if (choice === 'BASIC_JSON') return structuredClone(basicJsonProfile);
  const profile: unknown = JSON.parse(customText);
  if (!profile || typeof profile !== 'object' || Array.isArray(profile))
    throw new Error('Custom validation must be a JSON object.');
  return profile as Record<string, unknown>;
}
