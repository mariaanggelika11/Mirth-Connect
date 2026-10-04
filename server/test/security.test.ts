import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { roles, hasPermission, normalizeRole } from '../src/middleware/auth.js';
import { registration, channelSchema } from '../src/utils/validator.js';
import { encrypt, decrypt, publicEndpoint, storeEndpoint } from '../src/utils/secrets.js';
import { executeScript } from '../src/services/script.services.js';
import { sample } from './fixtures.js';
describe('Security boundaries', () => {
  it('fails without required secrets', () => {
    expect(() => loadConfig({})).toThrow();
    expect(() => loadConfig({ ...process.env, JWT_SECRET: 'default_secret' })).toThrow();
    expect(() => loadConfig({ ...process.env, CORS_ORIGINS: '*' })).toThrow();
    expect(() =>
      loadConfig({ ...process.env, DATABASE_URL: process.env.DATABASE_URL + '?sslmode=disable' }),
    ).toThrow();
    expect(() =>
      loadConfig({
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL + '?options=-c%20search_path=other',
      }),
    ).toThrow();
  });
  it('requires TLS and destination allowlist in production', () =>
    expect(() =>
      loadConfig({ ...process.env, NODE_ENV: 'production', PG_SSL: 'false' }),
    ).toThrow());
  it('register rejects role injection and weak passwords', () => {
    expect(
      registration.safeParse({
        username: 'admin',
        name: 'user',
        password: 'long-safe-password',
        role: 'ADMIN',
      }).success,
    ).toBe(false);
    expect(
      registration.safeParse({ username: 'user', name: 'user', password: 'short' }).success,
    ).toBe(false);
  });
  it('validates connector settings', () =>
    expect(
      channelSchema.safeParse({
        name: 'channel',
        source: { type: 'HTTP' },
        destinations: [
          { name: 'dest', type: 'REST', endpoint: 'http://localhost', maxRetries: 999 },
        ],
      }).success,
    ).toBe(false));
  it('roles have specific grants', () => {
    expect(hasPermission('VIEWER', 'channel:write')).toBe(false);
    expect(hasPermission('OPERATOR', 'message:resend')).toBe(true);
    expect(hasPermission('OPERATOR', 'channel:write')).toBe(false);
    expect(hasPermission('DEVELOPER', 'channel:write')).toBe(true);
    expect(hasPermission('DEVELOPER', 'channel:delete')).toBe(false);
    for (const role of roles) expect(hasPermission(role, 'channel:read')).toBe(true);
    expect(hasPermission('ADMIN', 'user:manage')).toBe(true);
    expect(normalizeRole('user')).toBe('VIEWER');
  });
  it('encrypts endpoint credentials, masks response and retains secret on unchanged edits', () => {
    const raw = 'http://user:password@localhost:8080/path?apiKey=secret';
    const encrypted = encrypt(raw);
    expect(encrypted).not.toContain('password');
    expect(decrypt(encrypted)).toBe(raw);
    const masked = publicEndpoint(encrypted);
    expect(masked.endpoint).not.toContain('secret');
    expect(masked.endpoint).not.toContain('password');
    expect(masked.credentialConfigured).toBe(true);
    expect(storeEndpoint(masked.endpoint, encrypted)).toBe(encrypted);
    expect(() => storeEndpoint('http://localhost:8080/new', encrypted)).toThrow();
    const replacement = 'http://user:newPassword@localhost:8080/new?apiKey=newSecret';
    expect(decrypt(storeEndpoint(replacement, encrypted))).toBe(replacement);
  });
  it('rejects tampered encrypted data', () =>
    expect(() => decrypt(encrypt('value').slice(0, -4) + 'AAAA')).toThrow());
});
describe('QuickJS isolated script execution', () => {
  it('rejects nonboolean filter results', async () => {
    await expect(executeScript('return "yes"', { msg: {} }, 'true')).rejects.toThrow(
      'Filter must return a boolean',
    );
  });
  it('transform and response succeed', async () => {
    expect(await executeScript('msg.x += 1; return msg;', { msg: { x: 1 } })).toEqual({ x: 2 });
    expect(
      await executeScript('return response.toUpperCase()', { msg: {}, response: 'ok' }, 'response'),
    ).toBe('OK');
  });
  it('provides HL7 helpers inside sandbox', async () =>
    expect(await executeScript("return hl7ToJson(msg).MSH['10']", { msg: sample })).toBe('ID123'));
  it('accepts/rejects filters', async () => {
    expect(await executeScript('return true', { msg: {} }, 'true')).toBe(true);
    expect(await executeScript('return false', { msg: {} }, 'true')).toBe(false);
  });
  it('isolates exceptions without payload disclosure', async () => {
    await expect(executeScript('throw new Error("PATIENT NAME")', { msg: {} })).rejects.toThrow(
      'Script execution failed',
    );
  });
  it('terminates infinite loops', async () => {
    await expect(executeScript('while(true){}', { msg: {} })).rejects.toThrow();
  });
  it('blocks process, filesystem, shell, network, and host constructor escape', async () => {
    expect(
      await executeScript(
        'return [typeof process,typeof require,typeof fetch,typeof WebSocket,typeof Buffer,typeof ({}).constructor.constructor("return globalThis")().process]',
        { msg: {} },
      ),
    ).toEqual(Array(6).fill('undefined'));
  });
  it('does not reuse global state', async () => {
    await executeScript('globalThis.leak=123;return msg', { msg: {} });
    expect(await executeScript('return typeof leak', { msg: {} })).toBe('undefined');
  });
  it('enforces memory limit', async () => {
    await expect(
      executeScript('let a=[];while(true){a.push(new Array(100000).fill("x"))}', { msg: {} }),
    ).rejects.toThrow();
  });
});
