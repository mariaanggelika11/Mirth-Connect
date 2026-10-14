import type { ReactNode } from 'react';
import React, { createContext, useState, useContext, useEffect } from 'react';
import { api, setAccessToken, getAccessToken, refreshSession, csrfToken } from '../services/api';
import { login as apiLogin } from '../services/auth.api';

interface AuthContextType {
  token: string | null;
  isLoggedIn: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  isInitializing: boolean;
  isLoggingIn: boolean;
  role: string;
  name: string;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [role, setRole] = useState('VIEWER');
  const [name, setName] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  useEffect(() => {
    let mounted = true;
    const expire = () => {
      localStorage.removeItem('authToken');
      setAccessToken(null);
      setToken(null);
      setRole('VIEWER');
    };
    window.addEventListener('auth:expired', expire);
    localStorage.removeItem('authToken');
    const refreshed = (event: Event) => {
      const current = (event as CustomEvent<string>).detail;
      if (mounted) setToken(current);
      void api
        .get('/auth/me')
        .then(({ data }) => {
          if (mounted && getAccessToken() === current) {
            setRole(data.data.role);
            setName(data.data.name || 'User');
          }
        })
        .catch(() => {
          if (mounted && getAccessToken() === current) setRole('VIEWER');
        });
    };
    window.addEventListener('auth:refreshed', refreshed);
    if (csrfToken())
      refreshSession()
        .then(async (saved) => {
          const { data } = await api.get('/auth/me');
          if (mounted) {
            setRole(data.data.role);
            setName(data.data.name || 'User');
            setToken(saved);
          }
        })
        .catch(() => {
          if (mounted) expire();
        })
        .finally(() => {
          if (mounted) setIsInitializing(false);
        });
    else setIsInitializing(false);
    return () => {
      mounted = false;
      window.removeEventListener('auth:expired', expire);
      window.removeEventListener('auth:refreshed', refreshed);
    };
  }, []);
  useEffect(() => {
    if (!token) return;
    let mounted = true;
    let last = 0;
    const reconcile = () => {
      if (document.hidden || Date.now() - last < 5000) return;
      last = Date.now();
      void api
        .get('/auth/me')
        .then(({ data }) => {
          if (mounted && getAccessToken() === token) {
            setRole(data.data.role);
            setName(data.data.name || 'User');
          }
        })
        .catch(() => {
          if (mounted && getAccessToken() === token) setRole('VIEWER');
        });
    };
    const timer = setInterval(reconcile, 60000);
    window.addEventListener('focus', reconcile);
    document.addEventListener('visibilitychange', reconcile);
    return () => {
      mounted = false;
      clearInterval(timer);
      window.removeEventListener('focus', reconcile);
      document.removeEventListener('visibilitychange', reconcile);
    };
  }, [token]);
  useEffect(() => {
    if (!token) return;
    try {
      const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (!Number.isFinite(claims.exp)) throw new Error();
      const timer = setTimeout(
        () => {
          void refreshSession().catch(() => window.dispatchEvent(new Event('auth:expired')));
        },
        Math.max(0, claims.exp * 1000 - Date.now()),
      );
      return () => clearTimeout(timer);
    } catch {
      localStorage.removeItem('authToken');
      setAccessToken(null);
      setToken(null);
    }
  }, [token]);

  const login = async (username: string, password: string) => {
    setIsLoggingIn(true);
    try {
      const { token } = await apiLogin(username, password);
      setAccessToken(token);
      const { data } = await api.get('/auth/me');
      setRole(data.data.role);
      setName(data.data.name || 'User');
      setToken(token);
    } catch (error) {
      localStorage.removeItem('authToken');
      setAccessToken(null);
      setToken(null);
      setRole('VIEWER');
      throw error;
    } finally {
      setIsLoggingIn(false);
    }
  };

  const logout = () => {
    void api
      .post('/auth/browser/logout', {}, { headers: { 'X-CSRF-Token': csrfToken() } })
      .catch(() => {});
    localStorage.removeItem('authToken');
    setAccessToken(null);
    setRole('VIEWER');
    setToken(null);
  };

  return (
    <AuthContext.Provider
      value={{
        token,
        role,
        name,
        can: (permission) =>
          role === 'ADMIN' ||
          (role === 'DEVELOPER' &&
            ['channel:write', 'channel:operate', 'message:payload'].includes(permission)) ||
          (role === 'OPERATOR' &&
            ['channel:operate', 'message:resend', 'message:payload'].includes(permission)),
        isLoggedIn: !!token,
        login,
        logout,
        isInitializing,
        isLoggingIn,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};
