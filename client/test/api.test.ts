import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios, { AxiosError } from 'axios';
import { api } from '../src/services/api';
const storage = new Map<string, string>();
const dispatch = vi.fn();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) || null,
  setItem: (k: string, v: string) => storage.set(k, v),
  removeItem: (k: string) => storage.delete(k),
});
vi.stubGlobal('window', { dispatchEvent: dispatch });
beforeEach(() => {
  storage.clear();
  dispatch.mockClear();
});
describe('Browser API session handling', () => {
  it('attaches stored token to requests', async () => {
    storage.set('authToken', 'token');
    let header = '';
    await api.get('/channel', {
      adapter: async (config) => {
        header = String(config.headers.Authorization);
        return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
      },
    });
    expect(header).toBe('Bearer token');
  });
  for (const code of ['TOKEN_EXPIRED', 'TOKEN_INVALID', 'NO_TOKEN', undefined])
    it('logs out on any 401: ' + code, async () => {
      storage.set('authToken', 'token');
      await expect(
        api.get('/channel', {
          adapter: async (config) => {
            throw new AxiosError('unauthorized', '401', config, undefined, {
              data: { code },
              status: 401,
              statusText: 'Unauthorized',
              headers: {},
              config,
            });
          },
        }),
      ).rejects.toThrow();
      expect(storage.has('authToken')).toBe(false);
      expect(dispatch).toHaveBeenCalledOnce();
    });
  it('keeps session on permission 403', async () => {
    storage.set('authToken', 'token');
    await expect(
      api.get('/channel', {
        adapter: async (config) => {
          throw new AxiosError('forbidden', '403', config, undefined, {
            data: { code: 'FORBIDDEN' },
            status: 403,
            statusText: 'Forbidden',
            headers: {},
            config,
          });
        },
      }),
    ).rejects.toThrow();
    expect(storage.get('authToken')).toBe('token');
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('wrong login password does not dispatch session expiration', async () => {
    await expect(
      api.post(
        '/auth/login',
        {},
        {
          adapter: async (config) => {
            throw new axios.AxiosError('invalid credentials', '401', config, undefined, {
              data: {},
              status: 401,
              statusText: 'Unauthorized',
              headers: {},
              config,
            });
          },
        },
      ),
    ).rejects.toThrow();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
