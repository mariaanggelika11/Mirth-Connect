import type { HttpSettings } from '../utils/httpSettings.js';
export interface Destination {
  delivery_policy?: {
    failureThreshold?: number;
    openSeconds?: number;
    maxConcurrency?: number;
    http?: HttpSettings;
  };
  id: number;
  channel_id: number;
  name: string;
  type: 'REST' | 'HL7' | 'MLLP' | 'TCP' | 'RAW';
  endpoint: string;
  outbound_data_type: 'HL7V2' | 'JSON' | 'XML' | 'TEXT';
  processing_script: string;
  template_script: string;
  response_script: string;
  filter_script: string;
  retry_enabled: boolean;
  max_retries: number;
  retry_interval_seconds: number;
  timeout_ms: number;
}
