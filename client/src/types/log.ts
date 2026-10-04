export enum LogLevel {
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  DEBUG = 'DEBUG',
}

export interface DestinationLog {
  destinationName: string;
  status: string;
  responseText: string;
  sentAt: string;
  requestData?: unknown;
  outboundData?: unknown;
}

export interface LogEntry {
  id: number;
  timestamp: string;
  channelId: number;
  channelName: string;
  level: LogLevel;
  message: string;

  content?: string;
  error?: string;

  originalPayload?: unknown;
  transformedPayload?: unknown;

  status?: string;
  direction?: 'IN' | 'OUT';

  destinationLogs?: DestinationLog[];
}
