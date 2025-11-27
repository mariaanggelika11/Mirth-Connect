// ================================
// ENUMS
// ================================
export enum ChannelStatus {
  RUNNING = "RUNNING",
  STOPPED = "STOPPED",
  ERROR = "ERROR",
}

export enum DestinationType {
  HL7 = "HL7",
  REST = "REST",
}

export enum DataType {
  HL7V2 = "HL7V2",
  XML = "XML",
  JSON = "JSON",
  TEXT = "TEXT",
}

// ================================
// SOURCE / DESTINATION
// ================================
export interface Source {
  type: string;
  endpoint: string;
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
}

export interface User {
  id: number;
  username: string;
  password_hash: string;
  name: string;
  role: string;
}

// ================================
// LOG SYSTEM
// ================================
export enum LogLevel {
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
  DEBUG = "DEBUG",
}

// ================================
// DESTINATION LOG (FINAL CORRECT)
// ================================
export interface DestinationLog {
  destinationName: string;
  status: string;
  responseText: string;
  sentAt: string;
  requestData?: any;
  outboundData?: any;
}

// ================================
// FINAL MAIN LOG ENTRY
// ================================
export interface LogEntry {
  id: number;
  timestamp: string;
  channelId: number;
  channelName: string;
  level: LogLevel;
  message: string;

  content?: string;
  error?: string;

  originalPayload?: any;
  transformedPayload?: any;

  status?: string;
  direction?: "IN" | "OUT";

  destinationLogs?: DestinationLog[];
}
