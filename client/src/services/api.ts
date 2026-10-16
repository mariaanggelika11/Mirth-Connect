import axios from 'axios';

let accessToken: string | null = null;
export const setAccessToken = (token: string | null) => {
  accessToken = token;
};
export const getAccessToken = () => accessToken;
export function csrfToken() {
  return (
    document.cookie
      .split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('mirth_csrf='))
      ?.slice(11) || ''
  );
}
let refreshing: Promise<string> | undefined;
export async function refreshSession() {
  if (!refreshing) {
    const perform = () =>
      api
        .post('/auth/browser/refresh', {}, { headers: { 'X-CSRF-Token': csrfToken() } })
        .then(({ data }) => {
          setAccessToken(data.token);
          window.dispatchEvent(new CustomEvent('auth:refreshed', { detail: data.token }));
          return data.token as string;
        });
    refreshing = (
      typeof navigator !== 'undefined' && navigator.locks
        ? navigator.locks.request('mirth-session-refresh', perform)
        : perform()
    ).finally(() => {
      refreshing = undefined;
    });
  }
  return refreshing;
}
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  timeout: 15000,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * REQUEST INTERCEPTOR
 * - Attach the in-memory access token.
 */
api.interceptors.request.use(
  (config) => {
    const token = accessToken;

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => Promise.reject(error),
);

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (typeof error.response?.data?.message === 'string')
      error.message = error.response.data.message;
    // Source API keys authenticate the connector independently of the operator's UI session.
    if (error.response?.data?.code === 'CONNECTOR_UNAUTHORIZED') return Promise.reject(error);
    const isLoginRequest = /\/auth\/(?:browser\/)?login/.test(error.config?.url || '');
    if (isLoginRequest) {
      return Promise.reject(error);
    }

    if (error.response?.status === 401 || error.response?.data?.code === 'TOKEN_INVALID') {
      if (
        !error.config?.url?.includes('/auth/browser/') &&
        !error.config?._retried &&
        accessToken
      ) {
        error.config._retried = true;
        try {
          await refreshSession();
          return api.request(error.config);
        } catch {
          /* Expire after refresh rejection. */
        }
      }
      setAccessToken(null);
      localStorage.removeItem('authToken');
      window.dispatchEvent(new Event('auth:expired'));
    }

    return Promise.reject(error);
  },
);
