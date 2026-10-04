import axios from 'axios';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export const api = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * REQUEST INTERCEPTOR
 * - Tambahkan Bearer Token otomatis
 */
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('authToken');

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => Promise.reject(error),
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (typeof error.response?.data?.message === 'string')
      error.message = error.response.data.message;
    const isLoginRequest = error.config?.url?.includes('/auth/login');
    if (isLoginRequest) {
      return Promise.reject(error);
    }

    if (error.response?.status === 401 || error.response?.data?.code === 'TOKEN_INVALID') {
      localStorage.removeItem('authToken');
      window.dispatchEvent(new Event('auth:expired'));
    }

    return Promise.reject(error);
  },
);
