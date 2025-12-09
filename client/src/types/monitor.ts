export enum DataType {
  HL7V2 = "HL7V2",
  XML = "XML",
  JSON = "JSON",
  TEXT = "TEXT",
}

export interface MonitorStats {
  totalReceived: number;
  totalSent: number;
  totalErrors: number;
  channelsRunning: number;
  channelsStopped: number;
  channelsError: number;
}
