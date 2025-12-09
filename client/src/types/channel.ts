import { DataType } from "./monitor";

export enum ChannelStatus {
  RUNNING = "RUNNING",
  STOPPED = "STOPPED",
  ERROR = "ERROR",
}

export enum DestinationType {
  HL7 = "HL7",
  MLLP = "MLLP",
  REST = "REST",
  TCP = "TCP",
  RAW = "RAW",
}

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
  sent?: number;
  errors?: number;
}

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

export interface ChannelFormData {
  name: string;
  source: Source;
  destinations: Destination[];
  processingScript?: string;
  responseScript?: string;
}
