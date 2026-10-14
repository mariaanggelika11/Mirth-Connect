import { describe, it, expect, vi, beforeEach } from 'vitest';
const state = vi.hoisted(() => ({
  query: vi.fn(),
  inputs: {} as Record<string, unknown>,
  history: [] as string[],
}));
const requestMock = () => ({
  input(k: string, v: unknown) {
    state.inputs[k] = v;
    return this;
  },
  query(sql: string) {
    state.history.push(sql);
    return state.query(sql);
  },
});
vi.mock('../src/config/db.js', () => ({
  withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ request: requestMock }),
}));
import { acquireDelivery, releaseDelivery } from '../src/services/circuitBreaker.services.js';
import { config } from '../src/config/env.js';
beforeEach(() => {
  state.history = [];
  state.inputs = {};
  state.query.mockResolvedValue({ recordset: [], rowsAffected: [1] });
});
describe('Persisted circuit breaker and delivery concurrency', () => {
  it('open circuit prevents network admission', async () => {
    state.query.mockImplementation(async (sql) => ({
      recordset: sql.includes('SELECT *,') ? [{ is_open: true }] : [],
      rowsAffected: [1],
    }));
    expect(await acquireDelivery(1, 2)).toMatchObject({
      acquired: false,
      reason: 'DESTINATION_CIRCUIT_OPEN',
    });
    expect(state.history.some((sql) => sql.includes('INSERT INTO "DeliverySlots"'))).toBe(false);
  });
  it('global and destination capacities reject admission', async () => {
    for (const counts of [
      { total: config.delivery.maxActive, destination: 0 },
      { total: 1, destination: config.delivery.maxPerDestination },
    ]) {
      state.query.mockImplementation(async (sql) => ({
        recordset: sql.includes('SELECT count(*)') ? [counts] : [],
        rowsAffected: [1],
      }));
      expect(await acquireDelivery(1, 2)).toMatchObject({
        acquired: false,
        reason: 'DELIVERY_CAPACITY',
      });
    }
  });
  it('expired open state admits only one half-open probe', async () => {
    state.query.mockImplementation(async (sql) => ({
      recordset: sql.includes('SELECT *,')
        ? [{ open_until: new Date(0), is_open: false, probing: false }]
        : sql.includes('RETURNING message_id')
          ? [{ message_id: 1 }]
          : [],
      rowsAffected: [1],
    }));
    expect((await acquireDelivery(1, 2)).acquired).toBe(true);
    expect(state.history.some((sql) => sql.includes('SET probe_until'))).toBe(true);
    state.query.mockImplementation(async (sql) => ({
      recordset: sql.includes('SELECT *,') ? [{ probing: true }] : [],
      rowsAffected: [1],
    }));
    expect((await acquireDelivery(2, 2)).acquired).toBe(false);
  });
  it('duplicate active slot rejected and release checks ownership', async () => {
    state.query.mockImplementation(async (sql) => ({
      recordset: [],
      rowsAffected: [sql.includes('RETURNING message_id') ? 0 : 1],
    }));
    expect(await acquireDelivery(1, 2)).toMatchObject({
      acquired: false,
      reason: 'DELIVERY_ALREADY_ACTIVE',
    });
    await releaseDelivery(1, 2, 'synthetic-owner', true);
    expect(state.history.some((sql) => sql.includes('AND owner=@owner'))).toBe(true);
    expect(state.inputs.success).toBe(true);
  });
  it('failure threshold and reset derive from runtime configuration', async () => {
    await releaseDelivery(1, 2, 'synthetic-owner', false);
    expect(state.inputs.threshold).toBe(config.delivery.failureThreshold);
    expect(state.inputs.seconds).toBe(config.delivery.openSeconds);
    expect(state.history.at(-1)).toContain('WHEN @success THEN NULL');
  });
  it('destination policy overrides deployment defaults and caps local admission', async () => {
    state.query.mockImplementation(async (sql) => ({
      recordset: sql.includes('SELECT count(*)') ? [{ total: 1, destination: 1 }] : [],
      rowsAffected: [1],
    }));
    expect(await acquireDelivery(1, 2, { maxConcurrency: 1 })).toMatchObject({
      acquired: false,
      reason: 'DELIVERY_CAPACITY',
    });
    await releaseDelivery(1, 2, 'synthetic-owner', false, { failureThreshold: 2, openSeconds: 90 });
    expect(state.inputs.threshold).toBe(2);
    expect(state.inputs.seconds).toBe(90);
  });
  it('stale or expired delivery owner cannot overwrite the circuit after reset', async () => {
    state.query.mockResolvedValue({ recordset: [], rowsAffected: [0] });
    await releaseDelivery(1, 2, 'stale-owner', false);
    expect(state.history.some((sql) => sql.startsWith('UPDATE "DestinationRuntime"'))).toBe(false);
  });
});
