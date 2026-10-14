export interface MonitorStats {
  totalReceived: number;
  totalSent: number;
  totalErrors: number;
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
  destinationName: string;
  status: string;
  responseText: string;
  sentAt: string;
  requestData?: unknown;
  outboundData?: unknown;
}

// LOG ENTRY
export interface LogEntry {
  rawPayload?: boolean;
  channelRevision?: number;
  idempotencyApplied?: boolean;
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

  originalPayload?: unknown;
  transformedPayload?: unknown;

  status?: string;
  direction?: 'IN' | 'OUT';

  destinationLogs?: DestinationLog[];
}
