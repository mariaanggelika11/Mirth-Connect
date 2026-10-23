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
import { AppError } from '../src/utils/errors.js';
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
  it.each([
    { next: [], code: 'CHANNEL_NOT_FOUND' },
    { next: [{ ...channel, status: 'STOPPED', active_revision: 1 }], code: 'CHANNEL_STOPPED' },
    { next: [{ ...channel, status: 'ARCHIVED', active_revision: 1 }], code: 'CHANNEL_STOPPED' },
    { next: [{ ...channel, active_revision: 2 }], code: 'CHANNEL_REVISION_CHANGED' },
  ])('rejects changed channel before accepting a stale snapshot: $code', async ({ next, code }) => {
    let reads = 0;
    mock.query.mockImplementation(async (sql: string) => ({
      recordset: sql.includes('SELECT * FROM "Channels"')
        ? ++reads === 1
          ? [{ ...channel, active_revision: 1 }]
          : next
        : [],
    }));
    await expect(processInboundMessage(1, { fixture: true })).rejects.toMatchObject({ code });
    expect(mock.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO "Messages"'))).toBe(
      false,
    );
    expect(mock.send).not.toHaveBeenCalled();
  });
  for (const code of ['INVALID_ACK', 'DELIVERY_OUTCOME_UNKNOWN', 'ERR_BAD_RESPONSE'])
    it(
      'quarantines ambiguous ' + code + ' instead of automatically repeating delivery',
      async () => {
        let attemptStatus = '';
        mock.query.mockImplementation(async (sql: string) => {
          if (sql.includes('lease_until=NULL')) attemptStatus = String(mock.inputs.status);
          return {
            recordset: sql.includes('SELECT status') ? [{ status: 'DEAD_LETTER' }] : [],
            rowsAffected: [1],
          };
        });
        mock.send.mockRejectedValueOnce({ code });
        await processRetry(row);
        expect(attemptStatus).toBe('DEAD_LETTER');
        expect(mock.inputs.delay).toBe(null);
        expect(mock.send).toHaveBeenCalledOnce();
      },
    );
  it('accepted delivery with failed response script is never sent again automatically', async () => {
    mock.script.mockRejectedValueOnce(new Error('synthetic response-script error'));
    mock.query.mockImplementation(async (sql: string) => ({
      recordset: sql.includes('SELECT status') ? [{ status: 'OUT-SENT' }] : [],
      rowsAffected: [1],
    }));
    const snapshot = { ...dest, response_script: 'throw new Error("synthetic");' };
    await processRetry({ ...row, transport_config: encrypt(JSON.stringify(snapshot)) });
    expect(mock.send).toHaveBeenCalledOnce();
    expect(mock.inputs.error).toBe('RESPONSE_SCRIPT_FAILED_AFTER_DELIVERY');
    expect(mock.inputs.delay).toBe(null);
  });
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
  it('does not automatically retry permanent HTTP 4xx, but retains 408/429/5xx retry', () => {
    for (const code of [
      'HTTP_400',
      'HTTP_401',
      'HTTP_403',
      'HTTP_404',
      'HTTP_409',
      'HTTP_422',
      'INVALID_ENDPOINT',
      'DESTINATION_HOST_DENIED',
      'DESTINATION_ADDRESS_DENIED',
    ])
      expect(retryDecision(dest, 0, code)).toEqual({ status: 'OUT-ERROR', delay: null });
    for (const code of ['HTTP_408', 'HTTP_429', 'HTTP_500', 'HTTP_503'])
      expect(retryDecision(dest, 0, code)).toEqual({ status: 'QUEUED', delay: 30 });
  });
  it('records policy rejection without request duration or automatic retry', async () => {
    mock.send.mockRejectedValueOnce(
      new AppError(403, 'DESTINATION_HOST_DENIED', 'Destination hostname is not allowed'),
    );
    mock.query.mockImplementation(async (sql: string) => ({
      recordset: sql.includes('SELECT status') ? [{ status: 'OUT-ERROR' }] : [],
      rowsAffected: [1],
    }));
    const result = await processRetry(row);
    expect(mock.inputs.httpStatus).toBeNull();
    expect(mock.inputs.requestDurationMs).toBeNull();
    expect(mock.inputs.delay).toBeNull();
    expect(result.status).toBe('OUT-ERROR');
  });
  it('stopped channel never processes', async () => {
    mock.query.mockResolvedValueOnce({ recordset: [{ ...channel, status: 'STOPPED' }] });
    await expect(processInboundMessage(1, {})).rejects.toThrow('Channel is not running');
    expect(mock.send).not.toHaveBeenCalled();
  });
  it('records outbound before send and success afterwards', async () => {
    const sequence: string[] = [];
    mock.query.mockImplementation(async (sql: string) => {
      sequence.push(sql);
      if (sql.includes('SELECT * FROM "Channels"'))
        return { rowsAffected: [1], recordset: [channel] };
      if (sql.includes('INSERT INTO "Messages"') && sql.includes("'IN'"))
        return { rowsAffected: [1], recordset: [{ id: 4 }] };
      if (sql.includes('SELECT * FROM "Destinations"'))
        return { rowsAffected: [1], recordset: [dest] };
      if (sql.includes('RETURNING *'))
        return { rowsAffected: [1], recordset: [{ ...row, status: 'PROCESSING' }] };
      if (sql.includes('SELECT status FROM "Messages"'))
        return { rowsAffected: [1], recordset: [{ status: 'OUT-SENT' }] };
      return { rowsAffected: [1], recordset: [] };
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
      rowsAffected: [1],
    }));
    await processRetry(row);
    expect(mock.send).toHaveBeenCalledWith(
      dest.endpoint,
      '{"data":1}',
      expect.any(Object),
      1000,
      expect.any(Function),
      'POST',
    );
    expect(mock.script).not.toHaveBeenCalled();
  });
  it('preserves historical prepared retries when a prior transport event proves preparation', async () => {
    mock.query.mockImplementation(async (sql: string) => ({
      recordset: sql.includes('SELECT EXISTS(SELECT 1 FROM "MessageDestinationLog"')
        ? [{ prepared: true }]
        : sql.includes('SELECT status')
          ? [{ status: 'OUT-SENT' }]
          : [],
      rowsAffected: [1],
    }));
    await processRetry({ ...row, status: 'RETRYING', last_error: 'HTTP_503' });
    expect(mock.send).toHaveBeenCalledOnce();
    expect(mock.send.mock.calls[0][1]).toBe('{"data":1}');
    expect(mock.script).not.toHaveBeenCalled();
  });
  it('converts incoming JSON to escaped HL7 before delivery', async () => {
    const hl7Dest = { ...dest, outbound_data_type: 'HL7V2' };
    mock.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM "Channels"'))
        return { rowsAffected: [1], recordset: [channel] };
      if (sql.includes('INSERT INTO "Messages"') && sql.includes("'IN'"))
        return { rowsAffected: [1], recordset: [{ id: 4 }] };
      if (sql.includes('SELECT * FROM "Destinations"'))
        return { rowsAffected: [1], recordset: [hl7Dest] };
      if (sql.includes('RETURNING *'))
        return { rowsAffected: [1], recordset: [{ ...row, status: 'PROCESSING' }] };
      if (sql.includes('SELECT status FROM "Messages"'))
        return { rowsAffected: [1], recordset: [{ status: 'OUT-SENT' }] };
      return { rowsAffected: [1], recordset: [] };
    });
    const result = await processInboundMessage(1, {
      PID: { '5': 'Budi|Santoso\rOBX|1' },
      MSH: { '9': { '1': 'ADT', '2': 'A01' }, '10': 'DELIVERY001', '11': 'P', '12': '2.5' },
    });
    expect(result.inboundStatus).toBe('SUCCESS');
    expect(mock.send).toHaveBeenCalledWith(
      dest.endpoint,
      expect.stringContaining('PID|||||Budi\\F\\Santoso\\X0D\\OBX\\F\\1\r'),
      expect.objectContaining({ 'Content-Type': 'application/hl7-v2' }),
      1000,
      expect.any(Function),
      'POST',
    );
  });
  for (const status of [201, 204, 400, 503])
    it('persists actual HTTP ' + status + ' metadata for the attempt', async () => {
      mock.send.mockImplementationOnce(
        async (
          _endpoint: string,
          _body: string,
          _headers: Record<string, string>,
          _timeout: number,
          onResponse: (code: number) => void,
        ) => {
          onResponse(status);
          if (status >= 300)
            throw new AppError(502, 'HTTP_' + status, 'Destination HTTP request failed');
          return status === 204 ? '' : 'created';
        },
      );
      await processRetry(row);
      expect(mock.inputs.httpStatus).toBe(status);
      expect(mock.inputs.response).toBe(
        status >= 300 ? 'HTTP_' + status : status === 204 ? '' : 'created',
      );
    });
  it('does not invent an HTTP status for a network failure', async () => {
    mock.send.mockRejectedValueOnce({ code: 'ECONNREFUSED' });
    await processRetry(row);
    expect(mock.inputs.httpStatus).toBeNull();
    expect(mock.inputs.response).toBe('ECONNREFUSED');
  });
  it('captures transport duration without including response scripts or persistence', async () => {
    let clock = 100;
    const timer = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    try {
      mock.send.mockImplementationOnce(async () => {
        clock += 25;
        return 'ok';
      });
      mock.script.mockImplementationOnce(async () => {
        clock += 500;
        return 'ok';
      });
      await processRetry({
        ...row,
        transport_config: encrypt(JSON.stringify({ ...dest, response_script: 'return response;' })),
      });
      expect(mock.inputs.requestDurationMs).toBe(25);
    } finally {
      timer.mockRestore();
    }
  });
  it('captures failed transport duration while retaining the safe error code', async () => {
    let clock = 200;
    const timer = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    try {
      mock.send.mockImplementationOnce(async () => {
        clock += 17;
        throw new AppError(504, 'DESTINATION_TIMEOUT', 'Synthetic transport timeout');
      });
      await processRetry(row);
      expect(mock.inputs.requestDurationMs).toBe(17);
      expect(mock.inputs.response).toBe('DESTINATION_TIMEOUT');
      expect(mock.inputs.httpStatus).toBeNull();
    } finally {
      timer.mockRestore();
    }
  });
  it('does not invent request timing when the circuit prevents transport', async () => {
    mock.query.mockImplementation(async (sql: string) => ({
      recordset: sql.includes('SELECT *,open_until') ? [{ is_open: true }] : [],
      rowsAffected: [1],
    }));
    await processRetry(row);
    expect(mock.send).not.toHaveBeenCalled();
    expect(mock.inputs.requestDurationMs).toBeNull();
    expect(mock.inputs.response).toBe('DESTINATION_CIRCUIT_OPEN');
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
