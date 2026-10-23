export interface MonitorStats {
  totalReceived: number;
  totalSent: number;
  totalErrors: number;
  successfulMessages?: number;
  failedMessages?: number;
  retryingMessages?: number;
  channelsRunning: number;
  channelsStopped: number;
  channelsError: number;
  messagesToday?: number;
  queuedMessages?: number;
  deadLetterMessages?: number;
}

// LOG SYSTEM
export enum LogLevel {
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  DEBUG = 'DEBUG',
}

// DESTINATION LOG
export interface DestinationLog {
  messageId?: number;
  canResend?: boolean;
  destinationId?: number;
  ackCode?: string;
  httpStatus?: number;
  durationMs?: number | null;
  attemptCount?: number | null;
  networkAttempted?: boolean;
  eventKind?:
    | 'DELIVERY_ATTEMPT'
    | 'DELIVERY_REJECTION'
    | 'FILTERED'
    | 'PREPARATION_FAILURE'
    | 'ADMISSION_WAIT'
    | 'UNKNOWN';
  occurredAt?: string;
  destinationName: string;
  outboundFormat?: string;
  connectorType?: string;
  snapshotCaptured?: boolean;
  status: string;
  responseText: string;
  sentAt?: string;
  requestData?: unknown;
  outboundData?: unknown;
}
export interface DestinationOutcome {
  destinationId: number;
  name: string;
  enabled: boolean;
  status: string;
  filter: 'BYPASSED' | 'MATCHED' | 'NOT_MATCHED' | 'NOT_RUN' | 'ERROR' | 'UNKNOWN';
  transformation: 'TRANSFORMED' | 'PASS_THROUGH' | 'ERROR' | 'NOT_RUN' | 'UNKNOWN';
  template: 'APPLIED' | 'NOT_CONFIGURED' | 'ERROR' | 'NOT_RUN' | 'UNKNOWN';
  conversion: 'CONVERTED' | 'ERROR' | 'NOT_RUN' | 'UNKNOWN';
  delivery: 'SENT' | 'FAILED' | 'QUEUED' | 'FILTERED' | 'DISABLED' | 'NOT_SENT' | 'UNKNOWN';
  code?: string;
  occurredAt?: string;
  attemptCount: number | null;
}

// LOG ENTRY
export interface LogEntry {
  rawPayload?: boolean;
  channelRevision?: number;
  idempotencyApplied?: boolean;
  inboundFormat?: string;
  sourceTransformed?: boolean;
  reconciliation?: { state: string; note: string; category: string };
  id: number;
  payloadAllowed?: boolean;
  retryCount?: number;
  nextRetryAt?: string;
  correlationId?: string;
  destinationPagination?: { page: number; pageSize: number; hasNext: boolean };
  timestamp: string;
  channelId: number;
  channelName: string;
  level: LogLevel;
  message: string;

  content?: string;
  error?: string;
  errorCode?: string;
  validation?: { code: 'FIELD_VALIDATION_FAILED'; results: ValidationRuleResult[] };

  originalPayload?: unknown;
  transformedPayload?: unknown;

  status?: string;
  direction?: 'IN' | 'OUT';

  destinationLogs?: DestinationLog[];
  destinationOutcomes?: DestinationOutcome[];
}
import type { ValidationRuleResult } from '../../../server/src/utils/validationRules';
