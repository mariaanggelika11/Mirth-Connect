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
      if (sql.includes('COUNT('))
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
    expect(state.history.some((h) => h.sql.includes('IN (42)'))).toBe(true);
    expect(res.body.data[0].originalPayload).toBeUndefined();
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
          },
        ],
      };
    });
    const res = await request(app)
      .get('/api/message/42')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(200);
    expect(res.body.data.payloadAllowed).toBe(false);
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
    expect(state.history[2].sql).toContain('LIMIT 1000');
  });
});

describe('Overview statistics', () => {
  it('binds the requested local midnight and returns real queue metrics', async () => {
    state.query.mockImplementation(async (sql: string) =>
      sql.includes('SELECT id,name,role')
        ? { recordset: [{ id: 1, name: 'Test', role: 'VIEWER' }] }
        : { recordset: [{ messagesToday: 12, queuedMessages: 3, deadLetterMessages: 2 }] },
    );
    const response = await request(app)
      .get('/api/message/stats?dateFrom=2026-10-03T17:00:00Z')
      .set('Authorization', 'Bearer ' + token);
    expect(response.status).toBe(200);
    expect(response.body.messagesToday).toBe(12);
    expect(response.body.queuedMessages).toBe(3);
    const bound = state.history.find((h) => h.sql.includes('"messagesToday"'));
    expect((bound?.params.today as Date).toISOString()).toBe('2026-10-03T17:00:00.000Z');
  });
  it('rejects malformed day boundaries', async () => {
    state.query.mockResolvedValue({ recordset: [{ id: 1, name: 'Test', role: 'VIEWER' }] });
    const response = await request(app)
      .get('/api/message/stats?dateFrom=invalid')
      .set('Authorization', 'Bearer ' + token);
    expect(response.status).toBe(400);
  });
});
