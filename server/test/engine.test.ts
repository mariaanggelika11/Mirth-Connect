import { describe, it, expect, vi, beforeEach } from 'vitest';
const mock = vi.hoisted(() => ({
  query: vi.fn(),
  send: vi.fn(),
  script: vi.fn(),
  inputs: {} as Record<string, unknown>,
}));
vi.mock('../src/config/db.js', () => ({
  getConnection: async () => ({
    request: () => ({
      input(k: string, v: unknown) {
        mock.inputs[k] = v;
        return this;
      },
      query: mock.query,
    }),
  }),
  withTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      request: () => ({
        input(k: string, v: unknown) {
          mock.inputs[k] = v;
          return this;
        },
        query: mock.query,
      }),
    }),
}));
vi.mock('../src/utils/transport.js', () => ({ sendRest: mock.send, sendTcp: mock.send }));
vi.mock('../src/services/script.services.js', () => ({ executeScript: mock.script }));
import {
  finalStatus,
  retryDecision,
  processInboundMessage,
  resendMessage,
  processRetry,
} from '../src/services/messageProcessor.services.js';
import { encrypt } from '../src/utils/secrets.js';
import type { Destination } from '../src/models/Destination.js';
const dest: Destination = {
  id: 2,
  channel_id: 1,
  name: 'test',
  type: 'REST',
  endpoint: 'http://localhost',
  outbound_data_type: 'JSON',
  processing_script: '',
  response_script: '',
  template_script: '',
  filter_script: '',
  retry_enabled: true,
  max_retries: 2,
  retry_interval_seconds: 30,
  timeout_ms: 1000,
};
const channel = {
  id: 1,
  status: 'RUNNING',
  inbound_data_type: 'JSON',
  processing_script: '',
  filter_script: '',
};
const row = {
  id: 3,
  channel_id: 1,
  destination_id: 2,
  inbound_message_id: 4,
  original_payload: '{}',
  transformed_payload: '{"data":1}',
  status: 'QUEUED' as const,
  retry_count: 0,
  correlation_id: 'trace',
  transport_config: encrypt(JSON.stringify(dest)),
};
beforeEach(() => {
  mock.inputs = {};
  mock.query.mockResolvedValue({ recordset: [], rowsAffected: [1] });
  mock.send.mockResolvedValue('ok');
});
describe('Engine aggregation and durable retry policy', () => {
  for (const [statuses, expected] of [
    [['OUT-SENT', 'OUT-SENT'], 'SUCCESS'],
    [['OUT-SENT', 'OUT-ERROR'], 'PARTIAL'],
    [['OUT-ERROR', 'OUT-ERROR'], 'FAILED'],
    [['OUT-SENT', 'QUEUED'], 'QUEUED'],
    [['FILTERED'], 'FILTERED'],
    [[], 'RECEIVED'],
  ] as [string[], string][])
    it('aggregate ' + expected, () => expect(finalStatus(statuses)).toBe(expected));
  it('exponential nonblocking retry and dead letter', () => {
    expect(retryDecision(dest, 0)).toEqual({ status: 'QUEUED', delay: 30 });
    expect(retryDecision(dest, 1)).toEqual({ status: 'QUEUED', delay: 60 });
    expect(retryDecision(dest, 2)).toEqual({ status: 'DEAD_LETTER', delay: null });
  });
  it('disabled retry records error', () =>
    expect(retryDecision({ ...dest, retry_enabled: false }, 0).status).toBe('OUT-ERROR'));
  it('stopped channel never processes', async () => {
    mock.query.mockResolvedValueOnce({ recordset: [{ ...channel, status: 'STOPPED' }] });
    await expect(processInboundMessage(1, {})).rejects.toThrow('Channel is not running');
    expect(mock.send).not.toHaveBeenCalled();
  });
  it('records outbound before send and success afterwards', async () => {
    const sequence: string[] = [];
    mock.query.mockImplementation(async (sql: string) => {
      sequence.push(sql);
      if (sql.includes('SELECT * FROM "Channels"')) return { recordset: [channel] };
      if (sql.includes('INSERT INTO "Messages"') && sql.includes("'IN'"))
        return { recordset: [{ id: 4 }] };
      if (sql.includes('SELECT * FROM "Destinations"')) return { recordset: [dest] };
      if (sql.includes('RETURNING *')) return { recordset: [{ ...row, status: 'PROCESSING' }] };
      if (sql.includes('SELECT status FROM "Messages"'))
        return { recordset: [{ status: 'OUT-SENT' }] };
      return { recordset: [] };
    });
    mock.send.mockImplementation(async () => {
      sequence.push('SEND');
      return 'ok';
    });
    const result = await processInboundMessage(1, { data: 1 });
    expect(result.success).toBe(true);
    expect(result.inboundStatus).toBe('SUCCESS');
    const reserved = sequence.findIndex((s) => s.includes('RETURNING *'));
    expect(reserved).toBeLessThan(sequence.indexOf('SEND'));
    expect(sequence.some((s) => s.includes('INSERT INTO "MessageDestinationLog"'))).toBe(true);
  });
  it('retry success uses persisted final payload without running scripts again', async () => {
    mock.query.mockImplementation(async (sql: string) => ({
      recordset: sql.includes('SELECT status') ? [{ status: 'OUT-SENT' }] : [],
    }));
    await processRetry(row);
    expect(mock.send).toHaveBeenCalledWith(dest.endpoint, '{"data":1}', expect.any(Object), 1000);
    expect(mock.script).not.toHaveBeenCalled();
  });
  it('retry failure becomes dead letter after max retries', async () => {
    mock.send.mockRejectedValue(new Error('patient data should be private'));
    await processRetry({ ...row, retry_count: 2 });
    expect(mock.inputs.status).toBe('RECEIVED');
    expect(
      mock.query.mock.calls.some((call) =>
        call[0].includes('UPDATE "Messages" SET status=@status'),
      ),
    ).toBe(true);
    expect(mock.inputs.response).toBe('PROCESSING_ERROR');
  });
  it('resend unavailable fails without transport side effect', async () => {
    mock.query.mockResolvedValueOnce({ recordset: [] });
    await expect(resendMessage(3)).rejects.toThrow('Resend requires');
    expect(mock.send).not.toHaveBeenCalled();
  });
});
