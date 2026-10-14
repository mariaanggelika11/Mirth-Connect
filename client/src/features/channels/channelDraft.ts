import { DataType, DestinationType } from '../../types';
import type { Channel, ChannelFormData, Destination } from '../../types';
export const newDestination = (): Destination => ({
  name: '',
  type: DestinationType.REST,
  endpoint: '',
  outboundDataType: DataType.HL7V2,
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
    source: {
      type: channel?.source.type === 'HL7' ? 'HL7' : 'HTTP',
      inboundDataType: channel?.source.inboundDataType || DataType.HL7V2,
    },
    processingScript: channel?.processingScript || '',
    filterScript: channel?.filterScript || '',
    responseScript: channel?.responseScript || '',
    destinations: channel
      ? channel.destinations.map((d) => ({ ...newDestination(), ...d }))
      : [newDestination()],
  };
}

export interface ChannelScriptEditor {
  destination?: number;
  field: 'processingScript' | 'responseScript' | 'templateScript';
  title: string;
}
