import { expect, it, vi } from 'vitest';
import request from 'supertest';

const state = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../src/config/db.js', () => {
  const database = {
    request: () => ({
      input() {
        return this;
      },
      query: state.query,
    }),
  };
  return {
    getConnection: async () => database,
    withTransaction: async (callback: (tx: typeof database) => Promise<unknown>) =>
      callback(database),
  };
});
import app from '../src/app.js';
import { signToken } from '../src/services/auth.services.js';

it('separates shared-NAT maintenance, credential aliases and logout budgets while bounding every auth path', async () => {
  const token = signToken({ id: 1, name: 'Synthetic', role: 'ADMIN' });
  state.query.mockImplementation(async (sql: string) => ({
    recordset: sql.startsWith('SELECT id,name,role FROM "Users"')
      ? [{ id: 1, name: 'Synthetic', role: 'ADMIN' }]
      : [],
    rowsAffected: [1],
  }));
  // Simulate two polling endpoints used by thirty users behind one proxy/NAT.
  for (let index = 0; index < 30; index++) {
    expect(
      (
        await request(app)
          .get('/api/auth/me')
          .set('Authorization', 'Bearer ' + token)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get('/api/auth/sessions')
          .set('Authorization', 'Bearer ' + token)
      ).status,
    ).toBe(200);
  }
  const invalidLogin = await request(app)
    .post('/api/auth/login')
    .send({ username: 'synthetic-unknown', password: 'synthetic-invalid-password' });
  expect(invalidLogin.status).toBe(401);
  // All credential route aliases share the same twenty-attempt budget, including
  // malformed bodies, case-insensitive route matches and optional trailing slash.
  const aliases = ['/api/auth/browser/login', '/api/auth/register', '/api/auth/LOGIN/'];
  for (let index = 0; index < 19; index++)
    expect(
      (
        await request(app)
          .post(aliases[index % aliases.length])
          .send({})
      ).status,
    ).toBe(400);
  const lookups = state.query.mock.calls.length;
  for (const alias of ['/api/auth/login', ...aliases]) {
    const denied = await request(app).post(alias).send({});
    expect(denied.status).toBe(429);
    expect(denied.headers['retry-after']).toBeDefined();
    expect(denied.body.code).toBe('RATE_LIMITED');
  }
  expect(state.query).toHaveBeenCalledTimes(lookups);
  // The remaining maintenance budget is usable despite exhausted login attempts.
  for (let index = 60; index < 300; index++)
    expect(
      (
        await request(app)
          .get('/api/auth/me')
          .set('Authorization', 'Bearer ' + token)
      ).status,
    ).toBe(200);
  const limited = await request(app)
    .get('/api/auth/me')
    .set('Authorization', 'Bearer ' + token);
  expect(limited.status).toBe(429);
  expect(limited.body.message).toBe('Too many session requests');
  expect((await request(app).get('/api/auth/unknown-session-route')).status).toBe(429);
  // Logout is not blocked by either exhausted budget, and remains rate-limited itself.
  const logout = () =>
    request(app)
      .post('/api/auth/browser/logout')
      .set('Cookie', 'mirth_refresh=synthetic-absent-token; mirth_csrf=synthetic-csrf')
      .set('X-CSRF-Token', 'synthetic-csrf');
  expect((await logout()).status).toBe(200);
  expect(
    (
      await request(app)
        .post('/api/auth/logout')
        .set('Authorization', 'Bearer ' + token)
    ).status,
  ).toBe(200);
  for (let index = 2; index < 60; index++) expect((await logout()).status).toBe(200);
  expect((await logout()).status).toBe(429);
});
