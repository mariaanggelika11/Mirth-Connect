import { describe, it, expect, vi, beforeEach } from 'vitest';
const state = vi.hoisted(() => ({ send: vi.fn(), query: vi.fn() }));
vi.mock('../src/utils/transport.js', () => ({ sendRest: state.send }));
vi.mock('../src/config/db.js', () => ({
  withTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      request: () => ({
        input() {
          return this;
        },
        query: state.query,
      }),
    }),
  getConnection: async () => ({
    request: () => ({
      input() {
        return this;
      },
      query: state.query,
    }),
  }),
}));
import { increment, observe, renderRuntimeMetrics } from '../src/utils/runtimeMetrics.js';
import { sendOperationalAlert, alertTick } from '../src/services/alert.services.js';
import { config } from '../src/config/env.js';
beforeEach(() => {
  state.send.mockReset().mockResolvedValue('ok');
  state.query.mockReset().mockImplementation(async (sql: string) => ({
    recordset: sql.includes('SELECT *,EXTRACT')
      ? [{ active: true, age: 999, state: 'OPEN', delivery_pending: false }]
      : [{ dead_letters: 0, queue_age: 0, channel_errors: 0 }],
  }));
  config.alerts.webhook = '';
});
describe('Runtime observability without PHI', () => {
  it('bounded histogram buckets and process counters expose no request labels', () => {
    increment('synthetic_total');
    observe('synthetic_seconds', 0.05);
    observe('synthetic_seconds', 2);
    const text = renderRuntimeMetrics();
    expect(text).toContain('mirth_synthetic_total 1');
    expect(text).toContain('mirth_synthetic_seconds_count 2');
    expect(text).toContain('mirth_synthetic_seconds_bucket{le="0.01"} 0');
    expect(text).not.toContain('patient');
  });
  it('disabled alerts do not call database or webhook', async () => {
    await alertTick();
    await sendOperationalAlert('CHANNEL_ERROR', true);
    expect(state.send).not.toHaveBeenCalled();
    expect(state.query).not.toHaveBeenCalled();
  });
  it('alerts deduplicate, recover and contain only fixed diagnostic metadata', async () => {
    config.alerts.webhook = 'http://localhost/synthetic-alert';
    try {
      await sendOperationalAlert('CHANNEL_ERROR', true);
      await sendOperationalAlert('CHANNEL_ERROR', true);
      expect(state.send).toHaveBeenCalledOnce();
      await sendOperationalAlert('CHANNEL_ERROR', false);
      expect(state.send).toHaveBeenCalledTimes(2);
      const body = JSON.parse(state.send.mock.calls[0][1]);
      expect(Object.keys(body).sort()).toEqual(['code', 'severity', 'status', 'timestamp']);
    } finally {
      config.alerts.webhook = '';
    }
  });
  it('failed webhook is contained and cooldown prevents a retry storm', async () => {
    config.alerts.webhook = 'http://localhost/synthetic-alert';
    state.send.mockRejectedValue(new Error('synthetic failure'));
    try {
      await sendOperationalAlert('QUEUE_AGE', true);
      await sendOperationalAlert('QUEUE_AGE', true);
      expect(state.send).toHaveBeenCalledOnce();
    } finally {
      config.alerts.webhook = '';
    }
  });
});
