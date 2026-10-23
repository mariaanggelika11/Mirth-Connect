import type { Destination } from '../../src/models/Destination.js';
import type { InboundStatus, OutboundStatus } from '../../src/models/Message.js';

/** Isolated engine persistence fixture; it never imports the real connection or dotenv. */
export type RuntimeConnector = Destination & { is_enabled: boolean; is_deleted: boolean };
export interface RuntimeMessage {
  id: number;
  channel_id: number;
  destination_id: number | null;
  inbound_message_id: number | null;
  original_payload: string;
  transformed_payload: string;
  transport_config: string | null;
  correlation_id: string;
  status: InboundStatus | OutboundStatus;
  retry_count: number;
  last_error: string | null;
  channel_revision: number;
}
export const runtimeDatabase = {
  channel: {
    id: 1,
    status: 'RUNNING',
    active_revision: 1,
    source_type: 'HTTP',
    source_api_key: '',
    inbound_data_type: 'JSON',
    processing_script: '',
    filter_script: '',
    validation_profile: '{}',
  },
  destinations: [] as RuntimeConnector[],
  messages: new Map<number, RuntimeMessage>(),
  attempts: [] as Record<string, unknown>[],
  writes: [] as { sql: string; inputs: Record<string, unknown> }[],
  reset() {
    this.channel = {
      id: 1,
      status: 'RUNNING',
      active_revision: 1,
      source_type: 'HTTP',
      source_api_key: '',
      inbound_data_type: 'JSON',
      processing_script: '',
      filter_script: '',
      validation_profile: '{}',
    };
    this.destinations = [];
    this.messages = new Map();
    this.attempts = [];
    this.writes = [];
  },
  query(sql: string, inputs: Record<string, unknown>) {
    this.writes.push({ sql, inputs: { ...inputs } });
    if (
      sql.includes('SELECT * FROM "Channels"') ||
      sql.includes('SELECT source_api_key') ||
      sql.includes('SELECT source_type,inbound_data_type')
    )
      return { recordset: [this.channel], rowsAffected: [1] };
    if (sql.includes('SELECT * FROM "Destinations"'))
      return {
        recordset: this.destinations.filter((dest) => dest.is_enabled && !dest.is_deleted),
        rowsAffected: [1],
      };
    if (sql.includes('INSERT INTO "Messages"')) {
      const inbound = sql.includes("'IN'");
      const row: RuntimeMessage = {
        id: this.messages.size + 10,
        channel_id: Number(inputs.channel),
        destination_id: inbound ? null : Number(inputs.dest),
        inbound_message_id: inbound ? null : Number(inputs.parent),
        original_payload: String(inputs.payload),
        transformed_payload: String(inputs.payload),
        transport_config: sql.includes('@snapshot') ? String(inputs.snapshot) : null,
        correlation_id: String(inputs.correlation),
        channel_revision: Number(inputs.revision),
        status: inbound ? 'IN-PROCESS' : 'PROCESSING',
        retry_count: 0,
        last_error: null,
      };
      this.messages.set(row.id, row);
      return { recordset: [row], rowsAffected: [1] };
    }
    if (sql.includes('SELECT status FROM "Messages"'))
      return {
        recordset: [...this.messages.values()]
          .filter((row) => row.inbound_message_id === inputs.id)
          .map(({ status }) => ({ status })),
        rowsAffected: [1],
      };
    if (sql.startsWith('UPDATE "Messages"')) {
      const row = this.messages.get(Number(inputs.id));
      if (row) {
        if (sql.includes('transformed_payload=@payload'))
          row.transformed_payload = String(inputs.payload);
        if (sql.includes('transport_config=@snapshot'))
          row.transport_config = String(inputs.snapshot);
        else if (sql.includes('transport_config=NULL')) row.transport_config = null;
        if (sql.includes('status=@status')) row.status = inputs.status as RuntimeMessage['status'];
        else if (sql.includes("status='IN-ERROR'")) row.status = 'IN-ERROR';
        else if (sql.includes("status='FILTERED'")) row.status = 'FILTERED';
        if ('error' in inputs) row.last_error = inputs.error as string | null;
        if ('count' in inputs) row.retry_count = Number(inputs.count);
      }
      return { recordset: row ? [row] : [], rowsAffected: [row ? 1 : 0] };
    }
    if (sql.includes('INSERT INTO "MessageDestinationLog"')) this.attempts.push({ ...inputs });
    return { recordset: [], rowsAffected: [1] };
  },
};
export const runtimeConnection = {
  request() {
    const inputs: Record<string, unknown> = {};
    return {
      input(key: string, value: unknown) {
        inputs[key] = value;
        return this;
      },
      async query(sql: string) {
        return runtimeDatabase.query(sql, inputs);
      },
    };
  },
};
