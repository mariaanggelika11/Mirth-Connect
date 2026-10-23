import type { HttpSettings } from '../../../server/src/utils/httpSettings';
export enum ChannelStatus {
  RUNNING = 'RUNNING',
  STOPPED = 'STOPPED',
  ERROR = 'ERROR',
  PAUSED = 'PAUSED',
  ARCHIVED = 'ARCHIVED',
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

// SOURCE / DESTINATION
export interface Source {
  type: string;
  endpoint?: string;
  inboundDataType?: DataType;
}

export interface Destination {
  deliveryPolicy?: {
    failureThreshold?: number;
    openSeconds?: number;
    maxConcurrency?: number;
    http?: HttpSettings;
  };
  circuitState?: string;
  circuitFailures?: number;
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

// CHANNEL ENTITY
export interface Channel {
  apiKeyConfigured?: boolean;
  validationProfile?: Record<string, unknown>;
  activeRevision?: number;
  draftRevision?: number;
  idempotencyMode?: 'OPTIONAL' | 'REQUIRED' | 'DISABLED';
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
  hasMessages?: boolean;
  sent?: number;
  errors?: number;
}

// CHANNEL FORM
export interface ChannelFormData {
  validationProfile?: Record<string, unknown>;
  changeSummary?: string;
  idempotencyMode?: 'OPTIONAL' | 'REQUIRED' | 'DISABLED';
  name: string;
  source: Source;
  destinations: Destination[];
  processingScript?: string;
  responseScript?: string;
  filterScript?: string;
}
