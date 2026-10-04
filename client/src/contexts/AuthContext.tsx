import React, { createContext, useState, useContext, ReactNode, useEffect } from 'react';
import { api } from '../services/api';
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
      setToken(null);
      setRole('VIEWER');
    };
    window.addEventListener('auth:expired', expire);
    const saved = localStorage.getItem('authToken');
    if (saved)
      api
        .get('/auth/me')
        .then(({ data }) => {
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
    };
  }, []);
  useEffect(() => {
    if (!token) return;
    try {
      const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (!Number.isFinite(claims.exp)) throw new Error();
      const timer = setTimeout(
        () => window.dispatchEvent(new Event('auth:expired')),
        Math.max(0, claims.exp * 1000 - Date.now()),
      );
      return () => clearTimeout(timer);
    } catch {
      localStorage.removeItem('authToken');
      setToken(null);
    }
  }, [token]);

  const login = async (username: string, password: string) => {
    setIsLoggingIn(true);
    try {
      const { token } = await apiLogin(username, password);
      localStorage.setItem('authToken', token);
      const { data } = await api.get('/auth/me');
      setRole(data.data.role);
      setName(data.data.name || 'User');
      setToken(token);
    } catch (error) {
      localStorage.removeItem('authToken');
      setToken(null);
      setRole('VIEWER');
      throw error;
    } finally {
      setIsLoggingIn(false);
    }
  };

  const logout = () => {
    void api
      .post('/auth/logout', {}, { headers: { Authorization: `Bearer ${token}` } })
      .catch(() => {});
    localStorage.removeItem('authToken');
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
