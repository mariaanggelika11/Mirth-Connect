export interface MonitorRow {
  id: number;
  channel_id: number;
  direction: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  correlation_id: string;
  retry_count: number;
  last_error: string;
  next_retry_at: Date;
  channel_name: string;
  original_payload: string;
  transformed_payload: string;
}
export interface DestinationLogRow {
  id: number;
  message_id: number;
  destination_id: number;
  destination_name: string;
  status: string;
  sent_at: Date;
  ack_code: string;
  message_control_id: string;
  request_data: string;
  outbound_data: string;
  response_text: string;
  inbound_message_id: number;
  retry_eligible?: boolean;
}
export function parsed(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}
export function logRow(row: DestinationLogRow, payload: boolean) {
  return {
    id: row.id,
    messageId: row.message_id,
    destinationId: row.destination_id,
    destinationName: row.destination_name,
    status: row.status,
    sentAt: row.sent_at,
    ackCode: row.ack_code,
    messageControlId: row.message_control_id,
    canResend: row.retry_eligible === true,
    ...(payload
      ? {
          requestData: parsed(row.request_data),
          outboundData: parsed(row.outbound_data),
          responseText: row.response_text,
        }
      : {}),
  };
}
