// ================================
// ENUMS
// ================================
export enum ChannelStatus {
  RUNNING = 'RUNNING',
  STOPPED = 'STOPPED',
  ERROR = 'ERROR',
  PAUSED = 'PAUSED',
}

export enum DestinationType {
  HL7 = 'HL7',
  MLLP = 'MLLP',
  REST = 'REST',
  TCP = 'TCP',
  RAW = 'RAW',
}

export enum DataType {
  HL7V2 = 'HL7V2',
  XML = 'XML',
  JSON = 'JSON',
  TEXT = 'TEXT',
}

// ================================
// SOURCE / DESTINATION
// ================================
export interface Source {
  type: string;
  endpoint?: string;
  inboundDataType?: DataType;
}

export interface Destination {
  id?: number;
  channel_id?: number;
  name: string;
  type: DestinationType;
  endpoint: string;
  outboundDataType?: DataType;
  processingScript?: string;
  responseScript?: string;
  templateScript?: string;
  filterScript?: string;
  isEnabled?: boolean;
  retryEnabled?: boolean;
  maxRetries?: number;
  retryIntervalSeconds?: number;
  timeoutMs?: number;
  credentialConfigured?: boolean;
  sent?: number;
  errors?: number;
}

// ================================
// CHANNEL ENTITY
// ================================
export interface Channel {
  id: number;
  name: string;
  status: ChannelStatus;
  source: Source;
  destinations: Destination[];
  processingScript?: string;
  responseScript?: string;
  filterScript?: string;
  created_at?: string;
  updated_at?: string;
  received?: number;
  sent?: number;
  errors?: number;
}

// ================================
// CHANNEL FORM
// ================================
export interface ChannelFormData {
  name: string;
  source: Source;
  destinations: Destination[];
  processingScript?: string;
  responseScript?: string;
  filterScript?: string;
}

// ================================
// MONITOR & USERS
// ================================
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

export interface User {
  id: number;
  username: string;
  name: string;
  role: string;
}

// ================================
// LOG SYSTEM
// ================================
export enum LogLevel {
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  DEBUG = 'DEBUG',
}

// ================================
// DESTINATION LOG (FINAL CORRECT)
// ================================
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

// ================================
// FINAL MAIN LOG ENTRY
// ================================
export interface LogEntry {
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
