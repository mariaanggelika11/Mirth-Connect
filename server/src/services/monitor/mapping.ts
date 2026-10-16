import { decrypt } from '../../utils/secrets.js';

export interface MonitorRow {
  channel_revision?: number;
  dedupe_key?: string;
  idempotency_key_hash?: string;
  reconciliation?: unknown;
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
  message_type?: string;
  inbound_format?: string;
  revision_configuration?: string;
}
export interface DestinationLogRow {
  id: number;
  message_id: number;
  destination_id: number;
  destination_name: string;
  status: string;
  sent_at: Date;
  ack_code: string;
  http_status?: number | null;
  message_control_id: string;
  request_data: string;
  outbound_data: string;
  response_text: string;
  inbound_message_id: number;
  retry_eligible?: boolean;
  transport_config?: string;
}
function capturedConfiguration(value?: string) {
  try {
    const parsed: unknown = value ? JSON.parse(decrypt(value)) : undefined;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    // Missing keys/corrupt historical metadata must never expose ciphertext or guessed formats.
    return undefined;
  }
}
export function sourceMetadata(row: MonitorRow) {
  const revision = capturedConfiguration(row.revision_configuration);
  return {
    inboundFormat: row.inbound_format || (row.direction === 'IN' ? row.message_type : undefined),
    sourceTransformed:
      revision && typeof revision.processingScript === 'string'
        ? Boolean(revision.processingScript.trim())
        : undefined,
  };
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
  const snapshot = capturedConfiguration(row.transport_config);
  return {
    id: row.id,
    messageId: row.message_id,
    destinationId: row.destination_id,
    destinationName: typeof snapshot?.name === 'string' ? snapshot.name : row.destination_name,
    outboundFormat:
      typeof snapshot?.outbound_data_type === 'string' ? snapshot.outbound_data_type : undefined,
    connectorType: typeof snapshot?.type === 'string' ? snapshot.type : undefined,
    snapshotCaptured: !!snapshot,
    status: row.status,
    sentAt: row.sent_at,
    ackCode: row.ack_code,
    httpStatus: row.http_status ?? undefined,
    messageControlId: payload && row.message_control_id ? '[REDACTED]' : undefined,
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
