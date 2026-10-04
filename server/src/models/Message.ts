export type InboundStatus =
  'IN-PROCESS' | 'IN-ERROR' | 'RECEIVED' | 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'FILTERED' | 'QUEUED';
export type OutboundStatus =
  'PROCESSING' | 'OUT-SENT' | 'OUT-ERROR' | 'QUEUED' | 'RETRYING' | 'DEAD_LETTER' | 'FILTERED';
export type Direction = 'IN' | 'OUT';
export interface StoredMessage {
  id: number;
  channel_id: number;
  destination_id: number;
  inbound_message_id: number;
  original_payload: string;
  transformed_payload: string;
  status: OutboundStatus;
  retry_count: number;
  correlation_id: string;
  transport_config: string;
}
