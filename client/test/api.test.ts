import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios, { AxiosError } from 'axios';
import { api, setAccessToken, getAccessToken, refreshSession } from '../src/services/api';
const storage = new Map<string, string>();
const dispatch = vi.fn();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) || null,
  setItem: (k: string, v: string) => storage.set(k, v),
  removeItem: (k: string) => storage.delete(k),
});
vi.stubGlobal('window', { dispatchEvent: dispatch });
vi.stubGlobal('document', { cookie: 'mirth_csrf=synthetic-csrf' });
beforeEach(() => {
  storage.clear();
  setAccessToken(null);
  dispatch.mockClear();
});
describe('Browser API session handling', () => {
  it('refresh is serialized and updates memory token without persistent storage', async () => {
    const adapter = api.defaults.adapter;
    let refreshCalls = 0;
    api.defaults.adapter = async (config) => {
      refreshCalls++;
      expect(config.headers['X-CSRF-Token']).toBe('synthetic-csrf');
      return {
        data: { token: 'refreshed-synthetic-token' },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      };
    };
    try {
      const result = await Promise.all([refreshSession(), refreshSession()]);
      expect(result).toEqual(['refreshed-synthetic-token', 'refreshed-synthetic-token']);
      expect(refreshCalls).toBe(1);
      expect(getAccessToken()).toBe('refreshed-synthetic-token');
      expect(storage.has('authToken')).toBe(false);
    } finally {
      api.defaults.adapter = adapter;
    }
  });
  it('attaches memory token and ignores persistent legacy token', async () => {
    storage.set('authToken', 'legacy-token');
    setAccessToken('token');
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
