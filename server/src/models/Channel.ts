export type ChannelStatus = 'RUNNING' | 'STOPPED' | 'PAUSED' | 'ERROR';
export interface Channel {
  validation_profile?: string;
  idempotency_mode?: string;
  active_revision?: number;
  id: number;
  name: string;
  status: ChannelStatus;
  source_type: 'HTTP' | 'HL7';
  inbound_data_type: string;
  filter_script: string;
  processing_script: string;
  response_script: string;
}
