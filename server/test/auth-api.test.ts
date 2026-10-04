import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
const mock = vi.hoisted(() => ({ query: vi.fn(), inputs: {} as Record<string, unknown> }));
vi.mock('../src/config/db.js', () => ({
  getConnection: vi.fn(async () => ({
    request: () => ({
      input(name: string, value: unknown) {
        mock.inputs[name] = value;
        return this;
      },
      query: mock.query,
    }),
  })),
  withTransaction: vi.fn(async (fn) =>
    fn({
      request: () => ({
        input(name: string, value: unknown) {
          mock.inputs[name] = value;
          return this;
        },
        query: mock.query,
      }),
    }),
  ),
}));
import app from '../src/app.js';
import { config } from '../src/config/env.js';
import { signToken, AuthService } from '../src/services/auth.services.js';
const user = { id: 1, name: 'Test', role: 'ADMIN' };
const token = (role = 'ADMIN') => signToken({ ...user, role });
beforeEach(() => {
  mock.inputs = {};
  mock.query.mockResolvedValue({ recordset: [user], rowsAffected: [1] });
});
describe('Authentication API', () => {
  it('login succeeds with bcrypt and returns bounded signed token', async () => {
    const hash = await bcrypt.hash('valid-password-123', 12);
    mock.query
      .mockResolvedValueOnce({ recordset: [{ ...user, password_hash: hash }] })
      .mockResolvedValueOnce({ recordset: [] });
    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'valid-password-123' });
    expect(response.status).toBe(200);
    const claims = jwt.verify(response.body.token, config.auth.jwtSecret, {
      issuer: config.auth.issuer,
      audience: config.auth.audience,
    }) as jwt.JwtPayload;
    expect(claims.exp! - claims.iat!).toBe(config.auth.expiration);
    expect(response.body.password_hash).toBeUndefined();
  });
  it('rejects wrong password and unknown user', async () => {
    mock.query.mockResolvedValue({ recordset: [] });
    await expect(AuthService.login('unknown', 'incorrect')).rejects.toThrow(
      'Invalid username or password',
    );
  });
  it('public registration creates VIEWER', async () => {
    mock.query
      .mockResolvedValueOnce({ recordset: [{ id: 2 }] })
      .mockResolvedValueOnce({ recordset: [] });
    const response = await request(app)
      .post('/api/auth/register')
      .send({ username: 'newuser', name: 'Test', password: 'valid-password-123' });
    expect(response.status).toBe(201);
    expect(mock.inputs.role).toBe('VIEWER');
    expect(mock.inputs.password_hash).not.toBe('valid-password-123');
  });
  it('duplicate username is a conflict', async () => {
    mock.query.mockRejectedValueOnce({ code: '23505' });
    const response = await request(app)
      .post('/api/auth/register')
      .send({ username: 'newuser', name: 'Test', password: 'valid-password-123' });
    expect(response.status).toBe(409);
  });
  it('role injection fails before SQL', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ username: 'newuser', name: 'Test', password: 'valid-password-123', role: 'ADMIN' });
    expect(response.status).toBe(400);
    expect(mock.query).not.toHaveBeenCalled();
  });
  it('missing token', async () =>
    expect((await request(app).get('/api/channel')).status).toBe(401));
  it('invalid token', async () =>
    expect(
      (await request(app).get('/api/channel').set('Authorization', 'Bearer invalid')).status,
    ).toBe(401));
  it('expired token', async () => {
    const expired = jwt.sign(user, config.auth.jwtSecret, {
      expiresIn: -1,
      issuer: config.auth.issuer,
      audience: config.auth.audience,
    });
    const response = await request(app)
      .get('/api/channel')
      .set('Authorization', 'Bearer ' + expired);
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('TOKEN_EXPIRED');
  });
  it('rejects wrong audience/issuer and tokens without expiration', async () => {
    for (const options of [
      { expiresIn: 3600, issuer: 'other', audience: config.auth.audience },
      { expiresIn: 3600, issuer: config.auth.issuer, audience: 'other' },
      { issuer: config.auth.issuer, audience: config.auth.audience },
    ]) {
      const forged = jwt.sign(user, config.auth.jwtSecret, options);
      expect(
        (
          await request(app)
            .get('/api/auth/me')
            .set('Authorization', 'Bearer ' + forged)
        ).status,
      ).toBe(401);
    }
  });
  it('role is read from database instead of stale JWT grants', async () => {
    mock.query.mockResolvedValue({ recordset: [{ ...user, role: 'VIEWER' }] });
    const response = await request(app)
      .post('/api/channel')
      .set('Authorization', 'Bearer ' + token())
      .send({});
    expect(response.status).toBe(403);
  });
  it('logout records a token revocation and audit atomically', async () => {
    const value = token();
    const response = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', 'Bearer ' + value);
    expect(response.status).toBe(200);
    expect(mock.inputs.token).toBe((jwt.decode(value) as jwt.JwtPayload).jti);
    expect(mock.query.mock.calls.some((c) => c[0].includes('INSERT INTO "RevokedTokens"'))).toBe(
      true,
    );
    expect(mock.inputs.action).toBe('LOGOUT');
  });
  it('deleted user cannot authenticate', async () => {
    mock.query.mockResolvedValue({ recordset: [] });
    expect(
      (
        await request(app)
          .get('/api/auth/me')
          .set('Authorization', 'Bearer ' + token())
      ).status,
    ).toBe(401);
  });
});
describe('HTTP security and runtime endpoints', () => {
  it('health does not require database', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
    expect(mock.query).not.toHaveBeenCalled();
  });
  it('readiness fails on database outage', async () => {
    mock.query.mockRejectedValue(new Error('secret credentials'));
    const response = await request(app).get('/ready');
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });
  it('CORS before routes', async () => {
    for (const origin of [
      'http://localhost:9000',
      'http://127.0.0.1:9000',
      'http://127.0.0.1:5173',
    ]) {
      const local = await request(app).get('/health').set('Origin', origin);
      expect(local.status).toBe(200);
      expect(local.headers['access-control-allow-origin']).toBe(origin);
    }
    const response = await request(app).get('/health').set('Origin', 'http://localhost:5173');
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect((await request(app).get('/health').set('Origin', 'http://evil.example')).status).toBe(
      403,
    );
  });
  it('unknown API endpoint is JSON 404', async () => {
    const response = await request(app).get('/api/nonexistent');
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });
  it('inbound requires connector credential, never management token', async () => {
    const response = await request(app)
      .post('/api/inbound/1')
      .set('Authorization', 'Bearer ' + token())
      .type('text')
      .send('data');
    expect(response.status).toBe(401);
  });
  it('valid connector credential reaches channel lookup and rejects missing channel', async () => {
    mock.query.mockResolvedValue({ recordset: [] });
    const response = await request(app)
      .post('/api/inbound/1')
      .set('X-API-Key', config.inbound.apiKey)
      .type('text')
      .send('data');
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('CHANNEL_NOT_FOUND');
  });
  it('enforces body limit', async () => {
    const response = await request(app)
      .post('/api/inbound/1')
      .set('X-API-Key', config.inbound.apiKey)
      .type('text')
      .send('x'.repeat(config.server.payloadLimit + 1));
    expect(response.status).toBe(413);
  });
  it('viewer payload route blocked', async () => {
    mock.query.mockResolvedValue({ recordset: [{ ...user, role: 'VIEWER' }] });
    expect(
      (
        await request(app)
          .post('/api/hl7/parse')
          .set('Authorization', 'Bearer ' + token('VIEWER'))
          .send({ message: 'MSH' })
      ).status,
    ).toBe(403);
  });
  it('viewer monitor query validates page bounds', async () => {
    const response = await request(app)
      .get('/api/message?pageSize=1000')
      .set('Authorization', 'Bearer ' + token());
    expect(response.status).toBe(400);
  });
});
