import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const state = vi.hoisted(() => ({
  now: Date.parse('2026-10-21T08:00:00.000Z'),
  families: new Map<string, Record<string, unknown>>(),
  sessions: new Map<string, Record<string, unknown>>(),
  audit: [] as string[],
  statements: [] as string[],
  failAudit: false,
  deleted: false,
  role: 'ADMIN',
  revokedJwt: false,
}));
// Throttling is covered by security-regression; this file exercises many isolated sessions.
vi.mock('express-rate-limit', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ipKeyGenerator: (ip: string) => ip,
}));
vi.mock('../src/config/db.js', () => {
  const database = {
    request: () => {
      const inputs: Record<string, unknown> = {};
      return {
        input(name: string, value: unknown) {
          inputs[name] = value;
          return this;
        },
        async query(sql: string) {
          state.statements.push(sql);
          let rows: Record<string, unknown>[] = [];
          let affected = 1;
          const family = state.families.get(String(inputs.family));
          const session = state.sessions.get(String(inputs.token));
          if (sql.startsWith('SELECT id,name,role FROM "Users"'))
            rows =
              state.deleted || state.revokedJwt
                ? []
                : [{ id: 1, name: 'Synthetic', role: state.role }];
          else if (sql.startsWith('INSERT INTO "BrowserSessionFamilies"'))
            state.families.set(String(inputs.family), {
              family_id: inputs.family,
              user_id: inputs.user,
              created_at: inputs.created,
              expires_at: inputs.expires,
              last_activity_at: inputs.created,
              revoked_at: null,
            });
          else if (sql.startsWith('INSERT INTO "BrowserSessions"'))
            state.sessions.set(String(inputs.token), {
              token_hash: inputs.token,
              family_id: inputs.family,
              user_id: inputs.user,
              csrf_hash: inputs.csrf,
              expires_at: inputs.expires,
              used_at: null,
              revoked_at: null,
            });
          else if (sql.startsWith('SELECT s.*,u.name,u.role'))
            rows =
              session && !state.deleted
                ? [{ ...session, name: 'Synthetic', role: state.role }]
                : [];
          else if (sql.startsWith('SELECT user_id,family_id,csrf_hash'))
            rows = session ? [session] : [];
          else if (sql.startsWith('SELECT family_id,user_id,created_at'))
            rows = family && family.user_id === inputs.user ? [family] : [];
          else if (sql.startsWith('SELECT csrf_hash'))
            rows =
              session &&
              session.family_id === inputs.family &&
              session.user_id === inputs.user &&
              !session.revoked_at &&
              !session.used_at &&
              new Date(session.expires_at as Date).getTime() > state.now
                ? [session]
                : [];
          else if (sql.startsWith('UPDATE "BrowserSessionFamilies" SET revoked_at')) {
            affected =
              family && (inputs.user === undefined || family.user_id === inputs.user) ? 1 : 0;
            if (affected && family) family.revoked_at ||= new Date(state.now);
          } else if (sql.startsWith('UPDATE "BrowserSessions" SET revoked_at')) {
            for (const entry of state.sessions.values())
              if (entry.family_id === inputs.family) entry.revoked_at ||= new Date(state.now);
          } else if (sql.startsWith('UPDATE "BrowserSessions" SET used_at')) {
            if (session) session.used_at = new Date(state.now);
          } else if (sql.startsWith('UPDATE "BrowserSessionFamilies" SET last_activity_at')) {
            if (family) family.last_activity_at = inputs.activity;
          } else if (sql.startsWith('INSERT INTO "AuditLog"')) {
            if (state.failAudit) throw new Error('Synthetic audit outage');
            state.audit.push(String(inputs.action));
          } else if (sql.startsWith('SELECT family_id,created_at,LEAST'))
            rows = [...state.families.values()].filter((entry) => entry.user_id === inputs.user);
          return { recordset: rows, rowsAffected: [affected] };
        },
      };
    },
  };
  return {
    getConnection: async () => database,
    withTransaction: async (callback: (tx: typeof database) => Promise<unknown>) => {
      const snapshot = structuredClone({
        families: state.families,
        sessions: state.sessions,
        audit: state.audit,
      });
      try {
        return await callback(database);
      } catch (error) {
        state.families = snapshot.families;
        state.sessions = snapshot.sessions;
        state.audit = snapshot.audit;
        throw error;
      }
    },
  };
});
import app from '../src/app.js';
import { config, loadConfig } from '../src/config/env.js';
import { AuthService, signToken } from '../src/services/auth.services.js';
import { hashToken } from '../src/services/session.services.js';

const familyId = '5321f81c-50b9-4da7-b879-357798a00001';
const refresh = 'synthetic-refresh-token';
const csrf = 'synthetic-csrf-token';
const cookies = `mirth_refresh=${refresh}; mirth_csrf=${csrf}`;
const policy = { ...config.auth };
let bearer: string;
function seed() {
  state.families.set(familyId, {
    family_id: familyId,
    user_id: 1,
    created_at: new Date(state.now),
    expires_at: new Date(state.now + 8 * 3600000),
    last_activity_at: new Date(state.now),
    revoked_at: null,
  });
  state.sessions.set(hashToken(refresh), {
    token_hash: hashToken(refresh),
    family_id: familyId,
    user_id: 1,
    csrf_hash: hashToken(csrf),
    expires_at: new Date(state.now + 8 * 3600000),
    used_at: null,
    revoked_at: null,
  });
}
function me(value = bearer) {
  return request(app)
    .get('/api/auth/me')
    .set('Authorization', 'Bearer ' + value);
}
function rotate() {
  return request(app)
    .post('/api/auth/browser/refresh')
    .set('Cookie', cookies)
    .set('X-CSRF-Token', csrf);
}
function activity(value = bearer, suppliedCookies = cookies) {
  return request(app)
    .post('/api/auth/browser/activity')
    .set('Authorization', 'Bearer ' + value)
    .set('Cookie', suppliedCookies)
    .set('X-CSRF-Token', csrf);
}
beforeEach(() => {
  state.now = Date.parse('2026-10-21T08:00:00.000Z');
  state.families.clear();
  state.sessions.clear();
  state.audit = [];
  state.statements = [];
  state.failAudit = false;
  state.deleted = false;
  state.role = 'ADMIN';
  state.revokedJwt = false;
  Object.assign(config.auth, policy);
  vi.spyOn(Date, 'now').mockImplementation(() => state.now);
  seed();
  bearer = signToken({ id: 1, name: 'Synthetic', role: 'ADMIN' }, familyId);
});
afterEach(() => {
  Object.assign(config.auth, policy);
  vi.restoreAllMocks();
});

describe('Browser idle and absolute session policy', () => {
  it('login creates a family with fixed eight-hour expiry and returns only safe policy metadata', async () => {
    vi.spyOn(AuthService, 'login').mockResolvedValue({ id: 1, token: 'unused-automation-token' });
    const response = await request(app)
      .post('/api/auth/browser/login')
      .send({ username: 'synthetic', password: 'valid-password-123' });
    expect(response.status).toBe(200);
    expect(response.body.session).toEqual({
      idleTimeoutSeconds: 900,
      warningSeconds: 60,
      idleExpiresAt: new Date(state.now + 900000).toISOString(),
      absoluteExpiresAt: new Date(state.now + 28800000).toISOString(),
      serverTime: new Date(state.now).toISOString(),
    });
    expect(state.families.size).toBe(2);
    expect(state.audit).toContain('BROWSER_LOGIN');
    expect(response.body).not.toHaveProperty('familyId');
    expect(JSON.stringify(state.audit)).not.toContain('unused-automation-token');
  });
  it('me reads current role and policy without extending last activity', async () => {
    const initial = state.families.get(familyId)!.last_activity_at;
    state.now += 60000;
    state.role = 'VIEWER';
    const response = await me();
    expect(response.status).toBe(200);
    expect(response.body.data.role).toBe('VIEWER');
    expect(response.body.session.serverTime).toBe(new Date(state.now).toISOString());
    expect(state.families.get(familyId)!.last_activity_at).toEqual(initial);
  });
  it('refresh rotates but preserves activity and absolute expiry, clamping cookie TTL to remaining lifetime', async () => {
    state.now += 120000;
    const response = await rotate();
    expect(response.status).toBe(200);
    expect(response.body.session.idleExpiresAt).toBe('2026-10-21T08:15:00.000Z');
    expect(response.body.session.absoluteExpiresAt).toBe('2026-10-21T16:00:00.000Z');
    expect(
      response.headers['set-cookie'].every((cookie: string) => cookie.includes('Max-Age=28680')),
    ).toBe(true);
    expect([...state.sessions.values()][1].expires_at).toEqual(
      new Date('2026-10-21T16:00:00.000Z'),
    );
    expect(state.families.get(familyId)!.last_activity_at).toEqual(
      new Date('2026-10-21T08:00:00.000Z'),
    );
  });
  it('idle expiry rejects refresh and commits one audited family-wide revocation', async () => {
    state.now += 900000;
    const first = await rotate();
    expect(first.status).toBe(401);
    expect(first.body.code).toBe('SESSION_IDLE_EXPIRED');
    expect(
      first.headers['set-cookie'].some((value: string) =>
        value.includes('Expires=Thu, 01 Jan 1970'),
      ),
    ).toBe(true);
    expect((await rotate()).body.code).toBe('SESSION_INVALID');
    expect(state.audit).toEqual(['SESSION_IDLE_EXPIRED']);
    expect(state.families.get(familyId)!.revoked_at).toBeTruthy();
    expect([...state.sessions.values()].every((value) => value.revoked_at)).toBe(true);
  });
  it('a still-valid browser JWT cannot bypass an idle deadline on a normal protected request', async () => {
    state.families.get(familyId)!.last_activity_at = new Date(state.now - 900000);
    const response = await me();
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('SESSION_IDLE_EXPIRED');
    expect(state.audit).toEqual(['SESSION_IDLE_EXPIRED']);
  });
  it('three-day-old sessions fail the absolute cap even with a future token expiry and recent activity', async () => {
    const row = state.families.get(familyId)!;
    row.created_at = new Date(state.now - 3 * 86400000);
    row.expires_at = new Date(state.now + 4 * 86400000);
    expect((await rotate()).body.code).toBe('SESSION_ABSOLUTE_EXPIRED');
    expect(state.audit).toEqual(['SESSION_ABSOLUTE_EXPIRED']);
  });
  it('absolute expiry rejects even if the last activity is current', async () => {
    state.families.get(familyId)!.expires_at = new Date(state.now);
    expect((await activity()).body.code).toBe('SESSION_ABSOLUTE_EXPIRED');
  });
  it('shortened deployment policy caps existing family expiry without rewriting its history', async () => {
    config.auth.absoluteExpiration = 3600;
    const row = state.families.get(familyId)!;
    row.created_at = new Date(state.now - 3600000);
    expect((await me()).body.code).toBe('SESSION_ABSOLUTE_EXPIRED');
  });
  it('a shorter idle policy also applies to an existing family immediately', async () => {
    config.auth.idleExpiration = 600;
    state.families.get(familyId)!.last_activity_at = new Date(state.now - 600000);
    expect((await me()).body.code).toBe('SESSION_IDLE_EXPIRED');
  });
  it('activity near the absolute limit can never move the idle deadline beyond that limit', async () => {
    state.families.get(familyId)!.created_at = new Date(state.now - 28800000 + 60000);
    state.families.get(familyId)!.expires_at = new Date(state.now + 60000);
    const response = await activity();
    expect(response.status).toBe(200);
    expect(response.body.session.idleExpiresAt).toBe(new Date(state.now + 60000).toISOString());
    expect(response.body.session.absoluteExpiresAt).toBe(response.body.session.idleExpiresAt);
  });
  it('explicit activity advances only idle expiry using server time, with the absolute limit unchanged', async () => {
    state.now += 60000;
    const response = await activity().send({
      lastActivityAt: '2099-01-01',
      expiresAt: '2099-01-01',
    });
    expect(response.status).toBe(200);
    expect(response.body.session.idleExpiresAt).toBe('2026-10-21T08:16:00.000Z');
    expect(response.body.session.absoluteExpiresAt).toBe('2026-10-21T16:00:00.000Z');
    expect(state.families.get(familyId)!.last_activity_at).toEqual(new Date(state.now));
  });
  it('activity cannot revive an already-idle family', async () => {
    state.families.get(familyId)!.last_activity_at = new Date(state.now - 900000);
    const response = await activity();
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('SESSION_IDLE_EXPIRED');
    expect(state.families.get(familyId)!.last_activity_at).toEqual(new Date(state.now - 900000));
  });
  it('activity requires CSRF and browser-family cookies, never an automation token alone', async () => {
    expect(
      (
        await request(app)
          .post('/api/auth/browser/activity')
          .set('Authorization', 'Bearer ' + bearer)
      ).status,
    ).toBe(403);
    expect((await activity(signToken({ id: 1, name: 'Synthetic', role: 'ADMIN' }))).body.code).toBe(
      'SESSION_INVALID',
    );
    expect((await activity(bearer, `mirth_refresh=different; mirth_csrf=${csrf}`)).body.code).toBe(
      'SESSION_INVALID',
    );
  });
  it('activity rejects a token cookie from another family and a consumed rotation token', async () => {
    state.sessions.get(hashToken(refresh))!.family_id = 'other-family';
    expect((await activity()).status).toBe(401);
    state.sessions.get(hashToken(refresh))!.family_id = familyId;
    state.sessions.get(hashToken(refresh))!.used_at = new Date(state.now);
    expect((await activity()).status).toBe(401);
  });
  it('refresh-token reuse revokes family and all rotations, blocking existing browser JWTs', async () => {
    state.sessions.get(hashToken(refresh))!.used_at = new Date(state.now);
    expect((await rotate()).status).toBe(401);
    expect(state.audit).toContain('REFRESH_REUSE');
    expect((await me()).body.code).toBe('SESSION_INVALID');
  });
  it('logout needs only CSRF and cookie, revokes family, clears cookies, and denies the old access token', async () => {
    const response = await request(app)
      .post('/api/auth/browser/logout')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', csrf);
    expect(response.status).toBe(200);
    expect(state.audit).toContain('BROWSER_LOGOUT');
    expect((await me()).body.code).toBe('SESSION_INVALID');
  });
  it('manual session revocation invalidates family and all rotations without deleting history', async () => {
    const response = await request(app)
      .post(`/api/auth/sessions/${familyId}/revoke`)
      .set('Authorization', 'Bearer ' + bearer);
    expect(response.status).toBe(200);
    expect(state.families.size).toBe(1);
    expect(state.sessions.size).toBe(1);
    expect((await me()).body.code).toBe('SESSION_INVALID');
    expect(state.audit).toContain('REVOKE_BROWSER_SESSION');
  });
  it('legacy Bearer logout also revokes the browser family when supplied a browser access token', async () => {
    const response = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', 'Bearer ' + bearer);
    expect(response.status).toBe(200);
    expect(state.families.get(familyId)!.revoked_at).toBeTruthy();
    expect((await rotate()).status).toBe(401);
  });
  it('a missing or revoked family fails closed for both access JWT and refresh', async () => {
    state.families.clear();
    expect((await me()).body.code).toBe('SESSION_INVALID');
    expect((await rotate()).body.code).toBe('SESSION_INVALID');
    seed();
    state.families.get(familyId)!.revoked_at = new Date(state.now);
    expect((await me()).body.code).toBe('SESSION_INVALID');
    expect((await rotate()).body.code).toBe('SESSION_INVALID');
  });
  it('invalid stored dates fail closed and deleted users or revoked JWT cannot use a family', async () => {
    state.families.get(familyId)!.last_activity_at = 'invalid';
    expect((await me()).status).toBe(401);
    seed();
    state.deleted = true;
    expect((await me()).status).toBe(401);
    state.deleted = false;
    state.revokedJwt = true;
    expect((await me()).status).toBe(401);
  });
  it('expiry cannot return an authenticated response when the audit transaction fails', async () => {
    state.families.get(familyId)!.last_activity_at = new Date(state.now - 900000);
    state.failAudit = true;
    const response = await me();
    expect(response.status).toBe(500);
    expect(response.body.session).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('Synthetic audit outage');
    expect(state.families.get(familyId)!.revoked_at).toBeNull();
  });
  it('automation Bearer tokens remain independent of browser timeout policy', async () => {
    const value = signToken({ id: 1, name: 'Synthetic', role: 'ADMIN' });
    state.families.clear();
    const response = await me(value);
    expect(response.status).toBe(200);
    expect(response.body).not.toHaveProperty('session');
  });
  it('never sends plaintext refresh token or CSRF secret into SQL/audit', async () => {
    await activity();
    await rotate();
    expect(state.statements.join('\n')).not.toContain(refresh);
    expect(state.statements.join('\n')).not.toContain(csrf);
    expect(JSON.stringify(state.audit)).not.toContain(refresh);
    expect(JSON.stringify(state.audit)).not.toContain(csrf);
  });
});
describe('Session environment validation', () => {
  it('defaults to eight hours and caps an existing seven-day refresh env without extending browser sessions', () => {
    const result = loadConfig({ ...process.env, REFRESH_TOKEN_SECONDS: '604800' });
    expect(result.auth).toMatchObject({
      uiExpiration: 300,
      refreshExpiration: 28800,
      absoluteExpiration: 28800,
      idleExpiration: 900,
      warningSeconds: 60,
    });
  });
  it('rejects inverted session policy, excessive absolute lifetime and warning at or beyond idle timeout', () => {
    for (const patch of [
      { SESSION_ABSOLUTE_SECONDS: '28801' },
      { SESSION_IDLE_SECONDS: '3600', SESSION_ABSOLUTE_SECONDS: '1800' },
      { SESSION_IDLE_SECONDS: '60', SESSION_WARNING_SECONDS: '60', UI_ACCESS_TOKEN_SECONDS: '60' },
      { UI_ACCESS_TOKEN_SECONDS: '900', SESSION_IDLE_SECONDS: '600' },
    ])
      expect(() => loadConfig({ ...process.env, ...patch })).toThrow();
  });
  it('permits a shorter policy and uses the smaller refresh/absolute bound', () => {
    expect(
      loadConfig({
        ...process.env,
        REFRESH_TOKEN_SECONDS: '3600',
        SESSION_ABSOLUTE_SECONDS: '7200',
      }).auth.absoluteExpiration,
    ).toBe(3600);
  });
});
