import axios, { type AxiosRequestConfig } from 'axios';
import { readBrowserSession, type BrowserSession } from './sessionLifecycle';

let accessToken: string | null = null;
let generation = 0;
let refreshing: Promise<string> | undefined;
let loggingOut: Promise<void> | undefined;
let loggingIn: Promise<unknown> | undefined;
let channel: BroadcastChannel | undefined;
let coordinated = false;
let localLock: Promise<unknown> = Promise.resolve();
export const LOGOUT_MARKER = 'mirth.logout-intent';
export const SESSION_ACTIVITY_MARKER = 'mirth.session-activity';
export type LogoutState = 'pending' | 'failed' | 'complete';
interface LogoutMarker {
  state: LogoutState;
  nonce: string;
}
export const setAccessToken = (token: string | null) => {
  accessToken = token;
};
export const getAccessToken = () => accessToken;
export const authGeneration = () => generation;
export const isCurrentAuth = (value: number) => value === generation;
export function removeLegacyToken() {
  try {
    localStorage.removeItem('authToken');
  } catch {
    /* Storage may be disabled. */
  }
}
function readLogoutCookie(): LogoutMarker | undefined {
  try {
    const raw = document.cookie
      .split(';')
      .map((value) => value.trim())
      .find((value) => value.startsWith('mirth_logout_intent='))
      ?.slice(20);
    if (!raw) return;
    const value = JSON.parse(decodeURIComponent(raw));
    return ['pending', 'failed', 'complete'].includes(value.state)
      ? value
      : { state: 'failed', nonce: raw };
  } catch {
    return;
  }
}
function writeLogoutCookie(marker?: LogoutMarker) {
  try {
    const secure =
      typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `mirth_logout_intent=${marker ? encodeURIComponent(JSON.stringify(marker)) : ''}; Path=/; Max-Age=${marker ? 31_536_000 : 0}; SameSite=Strict${secure}`;
  } catch {
    /* The in-memory marker still prevents restoration in this document. */
  }
}
function logoutMarker(): LogoutMarker | undefined {
  try {
    const raw = localStorage.getItem(LOGOUT_MARKER);
    if (raw) {
      const value = JSON.parse(raw);
      return ['pending', 'failed', 'complete'].includes(value.state)
        ? value
        : { state: 'failed', nonce: raw };
    }
  } catch {
    /* An optional noncredential cookie persists intent when storage is unavailable. */
  }
  return readLogoutCookie();
}
let memoryLogout: LogoutState | undefined;
export const logoutState = () => memoryLogout || logoutMarker()?.state;
export const hasLogoutIntent = () => !!logoutState();
function event(name: string, detail?: unknown) {
  window.dispatchEvent(detail === undefined ? new Event(name) : new CustomEvent(name, { detail }));
}
function postCoordination(message: unknown) {
  try {
    channel?.postMessage(message);
  } catch {
    /* A closed channel cannot restore a session. */
  }
}
function acceptLogout(state: LogoutState) {
  memoryLogout = state;
  generation++;
  accessToken = null;
  removeLegacyToken();
  event('auth:expired');
  event('auth:logout-state', state);
}
function markLogout(state: LogoutState) {
  const marker: LogoutMarker = { state, nonce: `${Date.now()}-${Math.random()}` };
  try {
    localStorage.setItem(LOGOUT_MARKER, JSON.stringify(marker));
  } catch {
    writeLogoutCookie(marker);
  }
  acceptLogout(state);
  postCoordination({ type: 'logout', state });
}
export function initializeSessionCoordination() {
  if (coordinated) return;
  coordinated = true;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel('mirth-browser-session');
      channel.onmessage = ({ data }) => {
        if (data?.type === 'logout' && ['pending', 'failed', 'complete'].includes(data.state))
          acceptLogout(data.state);
        if (data?.type === 'activity') receiveActivity(data);
      };
    } catch {
      /* Storage events remain available when channels are disabled. */
    }
  }
  window.addEventListener('storage', (change) => {
    if (change.key === LOGOUT_MARKER && change.newValue) {
      const marker = logoutMarker();
      if (marker) acceptLogout(marker.state);
    }
    if (change.key === SESSION_ACTIVITY_MARKER && change.newValue) {
      try {
        receiveActivity(JSON.parse(change.newValue));
      } catch {
        /* Ignore malformed noncredential metadata. */
      }
    }
  });
}
function receiveActivity(data: { session?: unknown; receivedAt?: unknown }) {
  if (hasLogoutIntent()) return;
  const metadata = readBrowserSession(data.session);
  if (metadata && typeof data.receivedAt === 'number' && Number.isFinite(data.receivedAt))
    event('auth:session', { session: metadata, receivedAt: data.receivedAt });
}
export function publishSession(value: unknown, broadcast = false): BrowserSession | undefined {
  const session = readBrowserSession(value);
  if (session && !hasLogoutIntent()) {
    const receivedAt = Date.now();
    event('auth:session', { session, receivedAt });
    if (broadcast) {
      const message = { type: 'activity', session, receivedAt };
      postCoordination(message);
      try {
        localStorage.setItem(SESSION_ACTIVITY_MARKER, JSON.stringify(message));
      } catch {
        /* BroadcastChannel or local clock remain. */
      }
    }
  }
  return session;
}
export function csrfToken() {
  return (
    document.cookie
      .split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('mirth_csrf='))
      ?.slice(11) || ''
  );
}
function withSessionLock<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks)
    return navigator.locks.request('mirth-session-refresh', work);
  const operation = localLock.then(work, work);
  localLock = operation.then(
    () => {},
    () => {},
  );
  return operation;
}
/** Automatic restoration requires persistent logout protection; explicit login still works. */
export function canBootstrapSession() {
  if (hasLogoutIntent()) return false;
  try {
    localStorage.setItem('mirth.session-storage-check', '1');
    localStorage.removeItem('mirth.session-storage-check');
    return true;
  } catch {
    return false;
  }
}
function superseded() {
  return new Error('The session changed. Please sign in again.');
}
export async function browserLogin(username: string, password: string) {
  await loggingOut?.catch(() => {});
  const attempt = ++generation;
  const operation = withSessionLock(async () => {
    if (!isCurrentAuth(attempt)) throw superseded();
    const { data } = await api.post('/auth/browser/login', { username, password });
    if (!isCurrentAuth(attempt)) throw superseded();
    memoryLogout = undefined;
    try {
      localStorage.removeItem(LOGOUT_MARKER);
    } catch {
      /* In-memory fallback. */
    }
    writeLogoutCookie();
    accessToken = data.token;
    publishSession(data.session);
    return data;
  });
  loggingIn = operation;
  try {
    return await operation;
  } finally {
    if (loggingIn === operation) loggingIn = undefined;
  }
}
export async function refreshSession() {
  if (hasLogoutIntent()) throw superseded();
  if (!refreshing) {
    const attempt = generation;
    refreshing = withSessionLock(async () => {
      if (!isCurrentAuth(attempt) || hasLogoutIntent()) throw superseded();
      const { data } = await api.post(
        '/auth/browser/refresh',
        {},
        { headers: { 'X-CSRF-Token': csrfToken() } },
      );
      if (!isCurrentAuth(attempt) || hasLogoutIntent()) throw superseded();
      accessToken = data.token;
      publishSession(data.session);
      event('auth:refreshed', data.token);
      return data.token as string;
    }).finally(() => {
      refreshing = undefined;
    });
  }
  return refreshing;
}
export function logoutSession() {
  if (loggingOut) return loggingOut;
  markLogout('pending');
  const pendingRefresh = refreshing;
  const pendingLogin = loggingIn;
  loggingOut = (async () => {
    // Also serialize when Web Locks are unavailable; a late rotation must finish before revocation.
    await pendingRefresh?.catch(() => {});
    await pendingLogin?.catch(() => {});
    try {
      await withSessionLock(() =>
        api.post('/auth/browser/logout', {}, { headers: { 'X-CSRF-Token': csrfToken() } }),
      );
      markLogout('complete');
    } catch (error) {
      markLogout('failed');
      throw error;
    }
  })().finally(() => {
    loggingOut = undefined;
  });
  return loggingOut;
}
export async function reportSessionActivity() {
  const attempt = generation;
  const perform = () =>
    withSessionLock(async () => {
      if (!accessToken || hasLogoutIntent() || !isCurrentAuth(attempt)) throw superseded();
      const { data } = await api.post('/auth/browser/activity', {}, {
        headers: { 'X-CSRF-Token': csrfToken() },
        _skipSessionRefresh: true,
      } as AxiosRequestConfig & { _skipSessionRefresh: boolean });
      if (!isCurrentAuth(attempt) || hasLogoutIntent()) throw superseded();
      return publishSession(data.session, true);
    });
  try {
    return await perform();
  } catch (error) {
    // Refresh only after releasing the activity lock; nested Web Locks would deadlock.
    if (
      axios.isAxiosError(error) &&
      error.response?.data?.code === 'TOKEN_EXPIRED' &&
      isCurrentAuth(attempt) &&
      !hasLogoutIntent()
    ) {
      await refreshSession();
      return perform();
    }
    throw error;
  }
}
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
export const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  timeout: 15000,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});
api.interceptors.request.use(
  (config) => {
    (config as typeof config & { _authGeneration: number })._authGeneration = generation;
    if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
    else delete config.headers.Authorization;
    return config;
  },
  (error) => Promise.reject(error),
);
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (typeof error.response?.data?.message === 'string')
      error.message = error.response.data.message;
    if (error.response?.data?.code === 'CONNECTOR_UNAUTHORIZED') return Promise.reject(error);
    if (
      typeof error.config?._authGeneration === 'number' &&
      !isCurrentAuth(error.config._authGeneration)
    )
      return Promise.reject(error);
    if (/\/auth\/(?:browser\/)?login/.test(error.config?.url || '')) return Promise.reject(error);
    if (error.config?._skipSessionRefresh && error.response?.data?.code === 'TOKEN_EXPIRED')
      return Promise.reject(error);
    if (error.response?.status === 401 || error.response?.data?.code === 'TOKEN_INVALID') {
      const terminal = [
        'SESSION_IDLE_EXPIRED',
        'SESSION_ABSOLUTE_EXPIRED',
        'SESSION_INVALID',
      ].includes(error.response?.data?.code);
      if (
        !terminal &&
        !/\/auth\/browser\/(?:refresh|logout)/.test(error.config?.url || '') &&
        !error.config?._retried &&
        accessToken
      ) {
        error.config._retried = true;
        try {
          await refreshSession();
          return api.request(error.config);
        } catch {
          /* Expire after rejection. */
        }
      }
      generation++;
      accessToken = null;
      removeLegacyToken();
      event('auth:expired', terminal ? error.response?.data?.code : undefined);
    }
    return Promise.reject(error);
  },
);
