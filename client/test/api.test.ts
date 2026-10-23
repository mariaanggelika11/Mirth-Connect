import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios, { AxiosError } from 'axios';
import { api, setAccessToken, getAccessToken, refreshSession } from '../src/services/api';
import { fetchChannels, archiveChannel } from '../src/services/channel.api';
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
  document.cookie = 'mirth_csrf=synthetic-csrf';
});
describe('Browser API session handling', () => {
  it('archived history is opt-in and forbidden archive keeps the current management session intact', async () => {
    const adapter = api.defaults.adapter;
    setAccessToken('synthetic-viewer-session');
    storage.set('authToken', 'ignored-legacy-token');
    const requests: { path?: string; archived: unknown }[] = [];
    api.defaults.adapter = async (config) => {
      expect(config.headers.Authorization).toBe('Bearer synthetic-viewer-session');
      expect(config.headers['X-API-Key']).toBeUndefined();
      requests.push({ path: config.url, archived: config.params?.includeArchived });
      if (config.method === 'post')
        throw new AxiosError('Permission denied', '403', config, undefined, {
          status: 403,
          statusText: 'Forbidden',
          data: { code: 'FORBIDDEN', message: 'Permission denied' },
          headers: {},
          config,
        });
      return { status: 200, statusText: 'OK', data: [], headers: {}, config };
    };
    try {
      await fetchChannels();
      await fetchChannels(true);
      await expect(archiveChannel(7)).rejects.toThrow('Permission denied');
      expect(requests).toEqual([
        { path: '/channel', archived: undefined },
        { path: '/channel', archived: true },
        { path: '/channel/7/archive', archived: undefined },
      ]);
      expect(getAccessToken()).toBe('synthetic-viewer-session');
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      api.defaults.adapter = adapter;
    }
  });
  it('rejects a source key failure without refreshing or expiring the operator session', async () => {
    const adapter = api.defaults.adapter;
    let requests = 0;
    setAccessToken('synthetic-operator-access-token');
    api.defaults.adapter = async (config) => {
      requests++;
      throw new AxiosError('Invalid connector credential', '401', config, undefined, {
        data: { code: 'CONNECTOR_UNAUTHORIZED', message: 'Invalid connector credential' },
        status: 401,
        statusText: 'Unauthorized',
        headers: {},
        config,
      });
    };
    try {
      await expect(
        api.post(
          '/message/inbound/1',
          { message: 'Synthetic' },
          {
            headers: { 'X-API-Key': 'invalid-synthetic-key' },
          },
        ),
      ).rejects.toThrow('Invalid connector credential');
      expect(requests).toBe(1);
      expect(getAccessToken()).toBe('synthetic-operator-access-token');
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      api.defaults.adapter = adapter;
    }
  });
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

describe('Session termination race protection', () => {
  async function freshApi() {
    vi.resetModules();
    return import('../src/services/api');
  }
  it('a refresh response arriving after sign out cannot restore memory or rotate after logout', async () => {
    const session = await freshApi();
    let release!: () => void;
    let started = false;
    const paths: string[] = [];
    session.api.defaults.adapter = async (config) => {
      paths.push(config.url!);
      if (config.url?.endsWith('/refresh')) {
        started = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return { data: { token: 'late-token' }, status: 200, statusText: 'OK', headers: {}, config };
    };
    const refreshing = session.refreshSession();
    const rejected = expect(refreshing).rejects.toThrow('session changed');
    await vi.waitFor(() => expect(started).toBe(true));
    const logout = session.logoutSession();
    expect(session.getAccessToken()).toBeNull();
    release();
    await rejected;
    await logout;
    expect(paths).toEqual(['/auth/browser/refresh', '/auth/browser/logout']);
    expect(session.getAccessToken()).toBeNull();
    expect(session.logoutState()).toBe('complete');
    expect(dispatch.mock.calls.some(([event]) => event.type === 'auth:refreshed')).toBe(false);
  });
  it('logout waits for an in-flight login, rejects the late login token and then revokes its cookie', async () => {
    const session = await freshApi();
    let release!: () => void;
    let started = false;
    const paths: string[] = [];
    session.api.defaults.adapter = async (config) => {
      paths.push(config.url!);
      if (config.url?.endsWith('/login')) {
        started = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return {
        data: { token: 'late-login-token' },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      };
    };
    const login = session.browserLogin('synthetic', 'placeholder');
    const rejected = expect(login).rejects.toThrow('session changed');
    await vi.waitFor(() => expect(started).toBe(true));
    const logout = session.logoutSession();
    release();
    await rejected;
    await logout;
    expect(paths).toEqual(['/auth/browser/login', '/auth/browser/logout']);
    expect(session.getAccessToken()).toBeNull();
  });
  it('failed logout is explicit, blocks refresh across reload, and can be retried without exposing a token', async () => {
    const session = await freshApi();
    session.setAccessToken('synthetic-access');
    session.api.defaults.adapter = async () => {
      throw new Error('offline');
    };
    await expect(session.logoutSession()).rejects.toThrow('offline');
    expect(session.getAccessToken()).toBeNull();
    expect(session.logoutState()).toBe('failed');
    const marker = storage.get(session.LOGOUT_MARKER)!;
    expect(marker).not.toContain('synthetic-access');
    const reloaded = await freshApi();
    expect(reloaded.logoutState()).toBe('failed');
    const calls: string[] = [];
    reloaded.api.defaults.adapter = async (config) => {
      calls.push(config.url!);
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
    };
    await expect(reloaded.refreshSession()).rejects.toThrow('session changed');
    expect(calls).toEqual([]);
    await reloaded.logoutSession();
    expect(reloaded.logoutState()).toBe('complete');
    expect(calls).toEqual(['/auth/browser/logout']);
  });
  it('only an explicit successful login clears the logout intent', async () => {
    const session = await freshApi();
    session.api.defaults.adapter = async (config) => ({
      data: {},
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    });
    await session.logoutSession();
    session.api.defaults.adapter = async (config) => {
      throw new AxiosError('invalid', '401', config, undefined, {
        status: 401,
        statusText: 'Unauthorized',
        headers: {},
        data: {},
        config,
      });
    };
    await expect(session.browserLogin('synthetic', 'wrong')).rejects.toThrow('invalid');
    expect(session.hasLogoutIntent()).toBe(true);
    session.api.defaults.adapter = async (config) => ({
      data: { token: 'new-explicit-login' },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    });
    await session.browserLogin('synthetic', 'placeholder');
    expect(session.hasLogoutIntent()).toBe(false);
    expect(session.getAccessToken()).toBe('new-explicit-login');
    expect(storage.has('authToken')).toBe(false);
  });
  for (const code of ['SESSION_IDLE_EXPIRED', 'SESSION_ABSOLUTE_EXPIRED', 'SESSION_INVALID'])
    it(`does not attempt refresh for terminal ${code}`, async () => {
      const session = await freshApi();
      session.setAccessToken('synthetic-access');
      let count = 0;
      session.api.defaults.adapter = async (config) => {
        count++;
        throw new AxiosError('Session ended', '401', config, undefined, {
          status: 401,
          statusText: 'Unauthorized',
          headers: {},
          data: { code },
          config,
        });
      };
      await expect(session.api.get('/auth/me')).rejects.toThrow('Session ended');
      expect(count).toBe(1);
      expect(session.getAccessToken()).toBeNull();
      expect(dispatch.mock.calls.at(-1)?.[0].detail).toBe(code);
    });
  it('only the explicit activity endpoint reports activity; ordinary polling does not call it', async () => {
    const session = await freshApi();
    session.setAccessToken('synthetic-access');
    const paths: string[] = [];
    const metadata = {
      idleTimeoutSeconds: 900,
      warningSeconds: 60,
      idleExpiresAt: '2026-10-21T00:15:00Z',
      absoluteExpiresAt: '2026-10-21T08:00:00Z',
      serverTime: '2026-10-21T00:00:00Z',
    };
    session.api.defaults.adapter = async (config) => {
      paths.push(config.url!);
      if (config.url?.endsWith('/activity')) {
        expect(config.headers.Authorization).toBe('Bearer synthetic-access');
        expect(config.headers['X-CSRF-Token']).toBe('synthetic-csrf');
      }
      return { data: { session: metadata }, status: 200, statusText: 'OK', headers: {}, config };
    };
    await session.api.get('/auth/me');
    await session.api.get('/channel');
    expect(paths).toEqual(['/auth/me', '/channel']);
    expect(await session.reportSessionActivity()).toEqual(metadata);
    expect(paths.at(-1)).toBe('/auth/browser/activity');
  });
});

describe('Cross-tab session coordination', () => {
  it('propagates logout and deadline activity without persisting credentials', async () => {
    vi.resetModules();
    const listeners = new Map<string, (event: { key: string; newValue: string }) => void>();
    let receive!: (event: { data: unknown }) => void;
    const post = vi.fn();
    class FakeChannel {
      constructor() {}
      set onmessage(value: typeof receive) {
        receive = value;
      }
      postMessage = post;
    }
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    vi.stubGlobal('window', {
      dispatchEvent: dispatch,
      addEventListener: (
        kind: string,
        callback: (event: { key: string; newValue: string }) => void,
      ) => listeners.set(kind, callback),
    });
    try {
      const session = await import('../src/services/api');
      session.initializeSessionCoordination();
      session.setAccessToken('synthetic-access-never-shared');
      const metadata = {
        idleTimeoutSeconds: 900,
        warningSeconds: 60,
        idleExpiresAt: '2026-10-21T00:15:00Z',
        absoluteExpiresAt: '2026-10-21T08:00:00Z',
        serverTime: '2026-10-21T00:00:00Z',
      };
      session.publishSession(metadata, true);
      expect(post).toHaveBeenCalledOnce();
      const stored = storage.get(session.SESSION_ACTIVITY_MARKER)!;
      expect(stored).not.toContain('synthetic-access-never-shared');
      dispatch.mockClear();
      listeners.get('storage')!({ key: session.SESSION_ACTIVITY_MARKER, newValue: stored });
      expect(dispatch.mock.calls[0][0].type).toBe('auth:session');
      receive({ data: { type: 'logout', state: 'failed' } });
      expect(session.getAccessToken()).toBeNull();
      await expect(session.refreshSession()).rejects.toThrow('session changed');
      const count = dispatch.mock.calls.length;
      receive({ data: { type: 'activity', session: metadata, receivedAt: Date.now() } });
      expect(dispatch).toHaveBeenCalledTimes(count);
    } finally {
      vi.stubGlobal('window', { dispatchEvent: dispatch });
      vi.unstubAllGlobals();
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => storage.get(k) || null,
        setItem: (k: string, v: string) => storage.set(k, v),
        removeItem: (k: string) => storage.delete(k),
      });
      vi.stubGlobal('window', { dispatchEvent: dispatch });
      vi.stubGlobal('document', { cookie: 'mirth_csrf=synthetic-csrf' });
    }
  });
  it('fails closed in memory when browser storage is disabled', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    try {
      const session = await import('../src/services/api');
      session.setAccessToken('synthetic-access');
      session.api.defaults.adapter = async () => {
        throw new Error('offline');
      };
      await expect(session.logoutSession()).rejects.toThrow('offline');
      expect(session.getAccessToken()).toBeNull();
      expect(session.logoutState()).toBe('failed');
      expect(document.cookie).toContain('SameSite=Strict');
      vi.resetModules();
      const reloaded = await import('../src/services/api');
      expect(reloaded.logoutState()).toBe('failed');
      expect(reloaded.canBootstrapSession()).toBe(false);
      await expect(session.refreshSession()).rejects.toThrow('session changed');
    } finally {
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => storage.get(k) || null,
        setItem: (k: string, v: string) => storage.set(k, v),
        removeItem: (k: string) => storage.delete(k),
      });
    }
  });
});

describe('Current session response guards', () => {
  it('an old request unauthorized response cannot clear a later explicit login', async () => {
    vi.resetModules();
    const session = await import('../src/services/api');
    session.setAccessToken('old-access');
    let release!: () => void;
    let started = false;
    const paths: string[] = [];
    session.api.defaults.adapter = async (config) => {
      paths.push(config.url!);
      if (config.url === '/channel') {
        started = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        throw new AxiosError('Old request expired', '401', config, undefined, {
          status: 401,
          statusText: 'Unauthorized',
          headers: {},
          data: { code: 'SESSION_INVALID' },
          config,
        });
      }
      return { status: 200, statusText: 'OK', headers: {}, data: { token: 'new-access' }, config };
    };
    const old = session.api.get('/channel');
    const rejected = expect(old).rejects.toThrow('Old request expired');
    await vi.waitFor(() => expect(started).toBe(true));
    await session.logoutSession();
    await session.browserLogin('synthetic', 'placeholder');
    dispatch.mockClear();
    release();
    await rejected;
    expect(session.getAccessToken()).toBe('new-access');
    expect(paths).not.toContain('/auth/browser/refresh');
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('refreshes an expired activity JWT after releasing the shared Web Lock', async () => {
    vi.resetModules();
    let held = false;
    const names: string[] = [];
    vi.stubGlobal('navigator', {
      locks: {
        request: async (name: string, callback: () => Promise<unknown>) => {
          expect(held).toBe(false);
          held = true;
          names.push(name);
          try {
            return await callback();
          } finally {
            held = false;
          }
        },
      },
    });
    try {
      const session = await import('../src/services/api');
      session.setAccessToken('expired-access');
      let activityCount = 0;
      session.api.defaults.adapter = async (config) => {
        if (config.url?.endsWith('/activity') && ++activityCount === 1)
          throw new AxiosError('Expired', '401', config, undefined, {
            status: 401,
            statusText: 'Unauthorized',
            headers: {},
            data: { code: 'TOKEN_EXPIRED' },
            config,
          });
        return {
          status: 200,
          statusText: 'OK',
          headers: {},
          data: {
            token: 'fresh-access',
            session: {
              idleTimeoutSeconds: 900,
              warningSeconds: 60,
              idleExpiresAt: '2026-10-21T00:15:00Z',
              absoluteExpiresAt: '2026-10-21T08:00:00Z',
              serverTime: '2026-10-21T00:00:00Z',
            },
          },
          config,
        };
      };
      expect(await session.reportSessionActivity()).toHaveProperty('idleTimeoutSeconds', 900);
      expect(activityCount).toBe(2);
      expect(names).toEqual([
        'mirth-session-refresh',
        'mirth-session-refresh',
        'mirth-session-refresh',
      ]);
      expect(session.getAccessToken()).toBe('fresh-access');
    } finally {
      vi.stubGlobal('navigator', undefined);
    }
  });
});
