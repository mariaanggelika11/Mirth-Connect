import { decrypt } from '../../utils/secrets.js';
import { readDestinationFilter } from '../../utils/sourceFilter.js';
import { preparationFailureDetails, legacyPreparationFailure } from '../engine/preparation.js';
import { deliveryRejected } from '../engine/policy.js';

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
  request_duration_ms?: number | null;
  attempt_count?: number | string | null;
  message_control_id: string;
  request_data: string;
  outbound_data: string;
  response_text: string;
  inbound_message_id: number;
  retry_eligible?: boolean;
  transport_config?: string;
  delivery_error?: string;
  processing_event?: 'DELIVERY_REJECTION' | 'ADMISSION_WAIT' | 'PREPARATION_FAILURE';
}
export interface DestinationOutcomeRow {
  id: number;
  destination_id: number;
  destination_name: string;
  status: string;
  last_error?: string;
  transport_config?: string;
  updated_at?: Date;
  recorded_attempts?: number | string;
  unknown_attempts?: number | string;
  admission_recorded?: boolean;
}
export interface DestinationOutcome {
  destinationId: number;
  name: string;
  enabled: boolean;
  status: string;
  filter: 'BYPASSED' | 'MATCHED' | 'NOT_MATCHED' | 'NOT_RUN' | 'UNKNOWN' | 'ERROR';
  transformation: 'TRANSFORMED' | 'PASS_THROUGH' | 'ERROR' | 'NOT_RUN' | 'UNKNOWN';
  template: 'APPLIED' | 'NOT_CONFIGURED' | 'ERROR' | 'NOT_RUN' | 'UNKNOWN';
  conversion: 'CONVERTED' | 'ERROR' | 'NOT_RUN' | 'UNKNOWN';
  delivery: 'SENT' | 'FAILED' | 'QUEUED' | 'FILTERED' | 'DISABLED' | 'NOT_SENT' | 'UNKNOWN';
  occurredAt?: Date;
  attemptCount: number | null;
  networkAttempted?: boolean;
  code?: string;
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
  const rejection =
    ['OUT-ERROR', 'QUEUED'].includes(row.status) &&
    row.http_status == null &&
    row.ack_code == null &&
    (row.processing_event === 'DELIVERY_REJECTION' || deliveryRejected(row.response_text));
  const network =
    !rejection &&
    ((typeof row.request_duration_ms === 'number' &&
      Number.isFinite(row.request_duration_ms) &&
      row.request_duration_ms >= 0) ||
      (typeof row.http_status === 'number' && row.http_status >= 100 && row.http_status <= 599) ||
      ['AA', 'AE', 'AR'].includes(row.ack_code));
  const admission =
    row.processing_event === 'ADMISSION_WAIT' ||
    ['DESTINATION_CIRCUIT_OPEN', 'DELIVERY_CAPACITY', 'DELIVERY_ALREADY_ACTIVE'].includes(
      row.response_text,
    );
  const preparation =
    row.status === 'OUT-ERROR' &&
    (row.processing_event === 'PREPARATION_FAILURE' ||
      legacyPreparationFailure(row.response_text) ||
      !!preparationFailureDetails(row.response_text));
  const eventKind = rejection
    ? 'DELIVERY_REJECTION'
    : network
      ? 'DELIVERY_ATTEMPT'
      : row.status === 'FILTERED'
        ? 'FILTERED'
        : admission
          ? 'ADMISSION_WAIT'
          : preparation
            ? 'PREPARATION_FAILURE'
            : 'UNKNOWN';
  const networkAttempted = network ? true : eventKind !== 'UNKNOWN' ? false : undefined;
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
    sentAt: networkAttempted === true ? row.sent_at : undefined,
    occurredAt: row.sent_at,
    eventKind,
    networkAttempted,
    ackCode: row.ack_code,
    httpStatus: row.http_status ?? undefined,
    durationMs:
      networkAttempted !== false &&
      typeof row.request_duration_ms === 'number' &&
      Number.isFinite(row.request_duration_ms) &&
      row.request_duration_ms >= 0
        ? row.request_duration_ms
        : null,
    attemptCount:
      networkAttempted === false && Number(row.attempt_count || 0) === 0
        ? 0
        : row.attempt_count != null &&
            Number.isSafeInteger(Number(row.attempt_count)) &&
            Number(row.attempt_count) > 0
          ? Number(row.attempt_count)
          : null,
    messageControlId: payload && row.message_control_id ? '[REDACTED]' : undefined,
    canResend:
      row.retry_eligible === true &&
      !preparationFailureDetails(row.delivery_error) &&
      !legacyPreparationFailure(row.delivery_error) &&
      (snapshot?.preparation_version === 1 ||
        network ||
        admission ||
        Number(row.attempt_count) > 0),
    ...(payload
      ? {
          requestData: parsed(row.request_data),
          outboundData: parsed(row.outbound_data),
          responseText: row.response_text,
        }
      : {}),
  };
}
export function destinationOutcomes(
  message: MonitorRow,
  rows: DestinationOutcomeRow[],
): DestinationOutcome[] {
  const revision = capturedConfiguration(message.revision_configuration);
  const configurations = Array.isArray(revision?.destinations)
    ? revision.destinations.slice(0, 50)
    : [];
  const outcomes: DestinationOutcome[] = rows
    .filter((row) => Number.isSafeInteger(row.id) && Number.isSafeInteger(row.destination_id))
    .slice(0, 50)
    .map((row) => {
      const snapshot = capturedConfiguration(row.transport_config);
      const historical = configurations.find(
        (value: unknown) =>
          value &&
          typeof value === 'object' &&
          (value as Record<string, unknown>).id === row.destination_id,
      );
      const settings =
        snapshot ||
        (historical && typeof historical === 'object'
          ? (historical as Record<string, unknown>)
          : undefined);
      const error = preparationFailureDetails(row.last_error);
      const attempts = Number(row.recorded_attempts || 0);
      const uncertain =
        Number(row.unknown_attempts || 0) > 0 || row.last_error === 'DELIVERY_OUTCOME_UNKNOWN';
      const prepared =
        !!snapshot &&
        (snapshot.preparation_version === 1 || attempts > 0 || row.admission_recorded === true);
      const blocked =
        row.status === 'FILTERED' || !!error || legacyPreparationFailure(row.last_error);
      let filter: DestinationOutcome['filter'] = 'UNKNOWN';
      if (settings) {
        try {
          filter = readDestinationFilter(
            String(settings.filter_script ?? settings.filterScript ?? ''),
          ).enabled
            ? 'MATCHED'
            : 'BYPASSED';
        } catch {
          filter = 'ERROR';
        }
      }
      const outcome: DestinationOutcome = {
        destinationId: row.destination_id,
        name:
          typeof settings?.name === 'string'
            ? settings.name
            : row.destination_name || 'Destination',
        enabled: true,
        status: row.status,
        filter: row.status === 'FILTERED' ? 'NOT_MATCHED' : prepared || error ? filter : 'UNKNOWN',
        transformation: 'NOT_RUN',
        template: 'NOT_RUN',
        conversion: 'NOT_RUN',
        delivery:
          row.status === 'FILTERED'
            ? 'FILTERED'
            : blocked
              ? 'NOT_SENT'
              : row.status === 'OUT-SENT'
                ? 'SENT'
                : ['QUEUED', 'RETRYING'].includes(row.status)
                  ? 'QUEUED'
                  : ['OUT-ERROR', 'DEAD_LETTER'].includes(row.status)
                    ? 'FAILED'
                    : 'UNKNOWN',
        occurredAt: row.updated_at,
        attemptCount: uncertain ? null : prepared || blocked ? attempts : null,
        networkAttempted:
          attempts > 0
            ? true
            : !uncertain &&
                (blocked ||
                  deliveryRejected(row.last_error) ||
                  (prepared && row.status === 'QUEUED'))
              ? false
              : undefined,
        ...(error
          ? { code: error.code }
          : row.last_error && /^[A-Z0-9_]{1,50}$/.test(row.last_error)
            ? { code: row.last_error }
            : {}),
      };
      const transformed =
        settings && !!String(settings.processing_script ?? settings.processingScript ?? '').trim();
      const template =
        settings && !!String(settings.template_script ?? settings.templateScript ?? '').trim();
      if (prepared) {
        outcome.transformation = transformed ? 'TRANSFORMED' : 'PASS_THROUGH';
        outcome.template = template ? 'APPLIED' : 'NOT_CONFIGURED';
        outcome.conversion = 'CONVERTED';
      } else if (error) {
        if (error.stage === 'filter') outcome.filter = 'ERROR';
        if (error.stage !== 'filter')
          outcome.transformation =
            error.stage === 'transformation'
              ? 'ERROR'
              : !settings
                ? 'UNKNOWN'
                : transformed
                  ? 'TRANSFORMED'
                  : 'PASS_THROUGH';
        if (error.stage === 'template') outcome.template = 'ERROR';
        if (error.stage === 'conversion') {
          outcome.template = !settings ? 'UNKNOWN' : template ? 'APPLIED' : 'NOT_CONFIGURED';
          outcome.conversion = 'ERROR';
        }
      } else if (!blocked) {
        outcome.transformation = 'UNKNOWN';
        outcome.template = 'UNKNOWN';
        outcome.conversion = 'UNKNOWN';
      }
      return outcome;
    });
  for (const candidate of configurations) {
    if (!candidate || typeof candidate !== 'object') continue;
    const dest = candidate as Record<string, unknown>;
    if (!Number.isSafeInteger(dest.id) || outcomes.some((item) => item.destinationId === dest.id))
      continue;
    const disabled = dest.isEnabled === false;
    outcomes.push({
      destinationId: dest.id as number,
      name: typeof dest.name === 'string' ? dest.name : 'Destination',
      enabled: !disabled,
      status: 'NOT_RUN',
      filter: 'NOT_RUN',
      transformation: 'NOT_RUN',
      template: 'NOT_RUN',
      conversion: 'NOT_RUN',
      delivery: disabled ? 'DISABLED' : 'NOT_SENT',
      attemptCount: 0,
      networkAttempted: false,
      occurredAt: message.updated_at,
    });
    if (outcomes.length >= 50) break;
  }
  return outcomes;
}
