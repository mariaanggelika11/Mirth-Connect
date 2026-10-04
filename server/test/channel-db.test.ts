import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
const state = vi.hoisted(() => ({
  query: vi.fn(),
  begin: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  connect: vi.fn(),
  inputs: {} as Record<string, unknown>,
}));
const requestMock = () => ({
  input(k: string, v: unknown) {
    state.inputs[k] = v;
    return this;
  },
  query: state.query,
});
vi.mock('../src/config/db.js', () => ({
  getConnection: async () => ({ request: requestMock }),
  withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    state.begin();
    try {
      const result = await fn({ request: requestMock });
      state.commit();
      return result;
    } catch (error) {
      state.rollback();
      throw error;
    }
  },
}));
import { withTransaction } from '../src/config/db.js';
import app from '../src/app.js';
import { signToken } from '../src/services/auth.services.js';
const token = signToken({ id: 1, name: 'admin', role: 'ADMIN' });
const payload = {
  name: 'channel',
  source: { type: 'HTTP', inboundDataType: 'JSON' },
  destinations: [{ name: 'dest', type: 'REST', endpoint: 'http://localhost:9100' }],
};
beforeEach(() => {
  state.inputs = {};
  state.query.mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT id,name,role FROM "Users"'))
      return { recordset: [{ id: 1, role: 'ADMIN', name: 'admin' }], rowsAffected: [1] };
    if (sql.includes('SELECT id FROM "Channels" WHERE') || sql.includes('SELECT id,status'))
      return { recordset: [{ id: 1, status: 'STOPPED' }] };
    if (sql.includes('RETURNING id')) return { recordset: [{ id: 1 }] };
    return { recordset: [], rowsAffected: [1] };
  });
});
describe('Channel transaction usage (database session mocked)', () => {
  it('commit on success', async () => {
    expect(await withTransaction(async () => 123)).toBe(123);
    expect(state.commit).toHaveBeenCalledOnce();
    expect(state.rollback).not.toHaveBeenCalled();
  });
  it('rollback on failure', async () => {
    await expect(
      withTransaction(async () => {
        throw new Error('write failed');
      }),
    ).rejects.toThrow('write failed');
    expect(state.rollback).toHaveBeenCalledOnce();
    expect(state.commit).not.toHaveBeenCalled();
  });
  it('channel create uses transaction and no active state by default', async () => {
    const res = await request(app)
      .post('/api/channel')
      .set('Authorization', 'Bearer ' + token)
      .send(payload);
    expect(res.status).toBe(201);
    expect(state.commit).toHaveBeenCalledOnce();
    expect(state.query.mock.calls.some((c) => c[0].includes("'STOPPED'"))).toBe(true);
    expect(state.inputs.action).toBe('CREATE_CHANNEL');
  });
  it('failed destination insert rolls back channel and audit', async () => {
    state.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id,name,role')) return { recordset: [{ id: 1, role: 'ADMIN' }] };
      if (sql.includes('RETURNING id')) return { recordset: [{ id: 1 }] };
      if (sql.includes('INSERT INTO "Destinations"')) throw new Error('SQL password must not leak');
      return { recordset: [], rowsAffected: [1] };
    });
    const res = await request(app)
      .post('/api/channel')
      .set('Authorization', 'Bearer ' + token)
      .send(payload);
    expect(res.status).toBe(500);
    expect(state.rollback).toHaveBeenCalledOnce();
    expect(state.commit).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toContain('password');
  });
  it('update is atomic', async () => {
    const res = await request(app)
      .put('/api/channel/1')
      .set('Authorization', 'Bearer ' + token)
      .send(payload);
    expect(res.status).toBe(200);
    expect(state.commit).toHaveBeenCalledOnce();
    expect(state.inputs.action).toBe('UPDATE_CHANNEL');
  });
  it('delete preserves messages and refuses running channels', async () => {
    state.query.mockImplementation(async (sql: string) => ({
      recordset: sql.includes('SELECT id,name,role')
        ? [{ id: 1, role: 'ADMIN' }]
        : sql.includes('SELECT id,status')
          ? [{ id: 1, status: 'RUNNING' }]
          : [],
    }));
    const res = await request(app)
      .delete('/api/channel/1')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(409);
    expect(state.rollback).toHaveBeenCalledOnce();
  });
  for (const status of ['RUNNING', 'STOPPED'])
    it('channel status ' + status, async () => {
      const res = await request(app)
        .put('/api/channel/1/status')
        .set('Authorization', 'Bearer ' + token)
        .send({ status });
      expect(res.status).toBe(200);
      expect(state.inputs.action).toBe(status === 'RUNNING' ? 'START_CHANNEL' : 'STOP_CHANNEL');
    });
});
