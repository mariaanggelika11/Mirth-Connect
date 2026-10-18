import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
const state = vi.hoisted(() => ({
  query: vi.fn(),
  retry: vi.fn(),
  aggregate: vi.fn(),
  inputs: {} as Record<string, unknown>,
  history: [] as { sql: string; params: Record<string, unknown> }[],
}));
const requestMock = () => ({
  input(k: string, v: unknown) {
    state.inputs[k] = v;
    return this;
  },
  async query(sql: string) {
    state.history.push({ sql, params: { ...state.inputs } });
    return state.query(sql);
  },
});
vi.mock('../src/config/db.js', () => ({
  getConnection: async () => ({ request: requestMock }),
  withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ request: requestMock }),
}));
vi.mock('../src/services/messageProcessor.services.js', () => ({
  processRetry: state.retry,
  updateAggregate: state.aggregate,
  processInboundMessage: vi.fn(),
  resendMessage: vi.fn(),
}));
import app from '../src/app.js';
import { signToken } from '../src/services/auth.services.js';
import { retryTick, retentionTick } from '../src/services/worker.services.js';
import { logRow, type DestinationLogRow } from '../src/services/monitor/mapping.js';
const token = signToken({ id: 1, name: 'Test', role: 'VIEWER' });
beforeEach(() => {
  state.inputs = {};
  state.history = [];
  state.query.mockResolvedValue({ recordset: [] });
});
describe('Monitor pagination and PHI separation', () => {
  it('bounded list and filters with selected log IDs', async () => {
    state.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id,name,role'))
        return { recordset: [{ id: 1, name: 'Test', role: 'VIEWER' }] };
      if (sql.includes('SELECT COUNT(*) total FROM'))
        return {
          recordsets: [
            [{ total: 101 }],
            [{ id: 42, channel_id: 1, direction: 'IN', status: 'SUCCESS', channel_name: 'Test' }],
          ],
        };
      return { recordset: [] };
    });
    const res = await request(app)
      .get('/api/message?page=2&pageSize=50&channelId=1&status=SUCCESS&search=Test')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(200);
    expect(res.body.pagination).toEqual({ page: 2, pageSize: 50, total: 101 });
    expect(state.history.find((h) => h.sql.includes('COUNT('))?.params.offset).toBe(50);
    expect(state.history.some((h) => h.params.ids === '42')).toBe(true);
    expect(res.body.data[0].originalPayload).toBeUndefined();
    const attemptSql = state.history.find((h) => h.sql.includes('WITH latest'))?.sql;
    expect(attemptSql).toContain('OVER(PARTITION BY l.message_id)');
    expect(attemptSql).toContain('DELIVERY_CAPACITY');
  });
  it('viewer detail omits all payloads and responses', async () => {
    state.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id,name,role'))
        return { recordset: [{ id: 1, name: 'Test', role: 'VIEWER' }] };
      if (sql.includes('SELECT m.*'))
        return {
          recordset: [
            {
              id: 42,
              channel_id: 1,
              original_payload: 'secret-patient',
              transformed_payload: 'secret-patient',
              direction: 'IN',
              status: 'SUCCESS',
            },
          ],
        };
      return {
        recordset: [
          {
            response_text: 'secret-patient',
            request_data: 'secret-patient',
            outbound_data: 'secret-patient',
            http_status: 201,
            request_duration_ms: 0,
            attempt_count: '3',
          },
        ],
      };
    });
    const res = await request(app)
      .get('/api/message/42')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(200);
    expect(res.body.data.payloadAllowed).toBe(false);
    expect(res.body.data.destinationLogs[0].httpStatus).toBe(201);
    expect(res.body.data.destinationLogs[0].durationMs).toBe(0);
    expect(res.body.data.destinationLogs[0].attemptCount).toBe(3);
    const detailSql = state.history.find((h) => h.sql.includes('SELECT l.*'))?.sql;
    expect(detailSql?.indexOf('OVER(PARTITION BY l.message_id)')).toBeLessThan(
      detailSql?.indexOf('LIMIT @limit') || 0,
    );
    expect(JSON.stringify(res.body)).not.toContain('secret-patient');
  });
});
describe('Durable scheduler and retention', () => {
  it('atomically claims only due messages on running channels', async () => {
    state.query
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{ id: 123 }] });
    await retryTick();
    expect(state.retry).toHaveBeenCalledWith({ id: 123 });
    const sql = state.history[2].sql;
    expect(sql).toContain('FOR UPDATE OF m SKIP LOCKED');
    expect(sql).toContain("c.status='RUNNING'");
    expect(sql).toContain('m.next_retry_at<=CURRENT_TIMESTAMP');
  });
  it('reconciles abandoned work instead of blind resend', async () => {
    state.query
      .mockResolvedValueOnce({ recordset: [] })
      .mockResolvedValueOnce({ recordset: [{ inbound_message_id: 10 }] })
      .mockResolvedValueOnce({ recordset: [] });
    await retryTick();
    expect(state.aggregate).toHaveBeenCalledWith(10);
    expect(state.retry).not.toHaveBeenCalled();
    expect(state.history[1].sql).toContain('DELIVERY_OUTCOME_UNKNOWN');
  });
  it('retention is bounded and preserves active jobs', async () => {
    await retentionTick();
    expect(state.history[0].sql).toContain('LIMIT 100');
    expect(state.history[0].sql).toContain(
      "'PROCESSING','QUEUED','RETRYING','OUT-ERROR','DEAD_LETTER'",
    );
    expect(state.history.some((h) => h.sql.includes('LIMIT 1000'))).toBe(true);
  });
});

describe('Overview statistics', () => {
  it('binds the requested local midnight and returns real queue metrics', async () => {
    state.query.mockImplementation(async (sql: string) =>
      sql.includes('SELECT id,name,role')
        ? { recordset: [{ id: 1, name: 'Test', role: 'VIEWER' }] }
        : {
            recordset: [
              {
                messagesToday: 12,
                queuedMessages: 3,
                deadLetterMessages: 2,
                successfulMessages: 9,
                failedMessages: 2,
                retryingMessages: 1,
              },
            ],
          },
    );
    const response = await request(app)
      .get('/api/message/stats?dateFrom=2026-10-03T17:00:00Z')
      .set('Authorization', 'Bearer ' + token);
    expect(response.status).toBe(200);
    expect(response.body.messagesToday).toBe(12);
    expect(response.body.queuedMessages).toBe(3);
    expect(response.body.successfulMessages).toBe(9);
    expect(response.body.failedMessages).toBe(2);
    expect(response.body.retryingMessages).toBe(1);
    const bound = state.history.find((h) => h.sql.includes('"messagesToday"'));
    expect((bound?.params.today as Date).toISOString()).toBe('2026-10-03T17:00:00.000Z');
    expect(bound?.sql).toContain("direction='IN' AND status='SUCCESS'");
    expect(bound?.sql).toContain("direction='IN' AND status IN ('FAILED','PARTIAL','IN-ERROR')");
    expect(bound?.sql).toContain("direction='OUT' AND status IN ('QUEUED','RETRYING')");
  });
  it('rejects malformed day boundaries', async () => {
    state.query.mockResolvedValue({ recordset: [{ id: 1, name: 'Test', role: 'VIEWER' }] });
    const response = await request(app)
      .get('/api/message/stats?dateFrom=invalid')
      .set('Authorization', 'Bearer ' + token);
    expect(response.status).toBe(400);
  });
});

describe('Captured delivery metadata', () => {
  const row = {
    id: 1,
    message_id: 2,
    destination_id: 3,
    destination_name: 'Synthetic',
    status: 'OUT-SENT',
    sent_at: new Date(),
    request_data: 'synthetic-private',
    outbound_data: 'synthetic-private',
    response_text: 'synthetic-private',
  } as DestinationLogRow;
  it('keeps old and mixed-history latency/attempt counts unknown', () => {
    expect(logRow(row, false)).toMatchObject({ durationMs: null, attemptCount: null });
    expect(logRow({ ...row, request_duration_ms: 1500, attempt_count: null }, false)).toMatchObject(
      { durationMs: 1500, attemptCount: null },
    );
  });
  it('rejects invalid captured metrics without exposing payload metadata', () => {
    for (const duration of [-1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(logRow({ ...row, request_duration_ms: duration }, false).durationMs).toBeNull();
    for (const count of [0, -1, 1.5, Number.POSITIVE_INFINITY, 'invalid'])
      expect(logRow({ ...row, attempt_count: count }, false).attemptCount).toBeNull();
    expect(
      JSON.stringify(logRow({ ...row, request_duration_ms: 1, attempt_count: 2 }, false)),
    ).not.toContain('synthetic-private');
  });
});

describe('Captured validation failure metadata in Messages', () => {
  it('shows a safe validation reason without exposing persisted diagnostic JSON or payload to Viewer', async () => {
    const last_error =
      'VALIDATION_DETAILS_V1:' +
      JSON.stringify({
        code: 'FIELD_VALIDATION_FAILED',
        results: [
          {
            field: 'patient_id',
            type: 'text',
            required: true,
            status: 'FAILED',
            code: 'REQUIRED',
            message: 'SYNTHETIC-PHI-EXCEPTION',
            value: 'SYNTHETIC-PHI-VALUE',
          },
        ],
      });
    state.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id,name,role'))
        return { recordset: [{ id: 1, name: 'Test', role: 'VIEWER' }] };
      if (sql.includes('SELECT m.*'))
        return {
          recordset: [
            {
              id: 42,
              channel_id: 1,
              direction: 'IN',
              status: 'IN-ERROR',
              channel_name: 'Test',
              last_error,
              original_payload: 'SYNTHETIC-PHI-PAYLOAD',
            },
          ],
        };
      if (sql.includes('SELECT COUNT(*) total FROM'))
        return {
          recordsets: [
            [{ total: 1 }],
            [{ id: 42, direction: 'IN', status: 'IN-ERROR', last_error }],
          ],
        };
      return { recordset: [] };
    });
    const response = await request(app)
      .get('/api/message/42')
      .set('Authorization', 'Bearer ' + token);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      status: 'IN-ERROR',
      errorCode: 'FIELD_VALIDATION_FAILED',
      validation: {
        code: 'FIELD_VALIDATION_FAILED',
        results: [{ field: 'patient_id', code: 'REQUIRED', message: 'Required value is missing.' }],
      },
      destinationLogs: [],
    });
    expect(JSON.stringify(response.body)).not.toContain('SYNTHETIC-PHI');
    const list = await request(app)
      .get('/api/message')
      .set('Authorization', 'Bearer ' + token);
    expect(list.body.data[0].errorCode).toBe('FIELD_VALIDATION_FAILED');
    expect(JSON.stringify(list.body)).not.toContain('VALIDATION_DETAILS_V1');
    expect(JSON.stringify(list.body)).not.toContain('SYNTHETIC-PHI');
  });
});
