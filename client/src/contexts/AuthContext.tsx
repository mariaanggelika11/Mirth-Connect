import type { ReactNode } from 'react';
import React, { createContext, useState, useContext, useEffect, useRef, useCallback } from 'react';
import {
  api,
  setAccessToken,
  getAccessToken,
  refreshSession,
  csrfToken,
  initializeSessionCoordination,
  hasLogoutIntent,
  canBootstrapSession,
  logoutSession,
  logoutState,
  reportSessionActivity,
  publishSession,
  authGeneration,
  isCurrentAuth,
  removeLegacyToken,
} from '../services/api';
import {
  fallbackSession,
  readBrowserSession,
  sessionClock,
  sessionRemaining,
  sessionServerNow,
  shouldSendActivity,
  type SessionClock,
} from '../services/sessionLifecycle';
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
  sessionWarningSeconds: number | null;
  continueSession: () => Promise<void>;
  sessionActivityError: string | null;
  isContinuingSession: boolean;
  logoutProblem: boolean;
  isLoggingOut: boolean;
  sessionNotice: string | null;
}
const AuthContext = createContext<AuthContextType | undefined>(undefined);
export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [role, setRole] = useState('VIEWER');
  const [name, setName] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutProblem, setLogoutProblem] = useState(() =>
    ['pending', 'failed'].includes(logoutState() || ''),
  );
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [clock, setClock] = useState<SessionClock | null>(null);
  const clockRef = useRef<SessionClock | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [sessionActivityError, setSessionActivityError] = useState<string | null>(null);
  const [isContinuingSession, setIsContinuingSession] = useState(false);
  const lastActivity = useRef(0);
  const activityPending = useRef<Promise<void> | undefined>(undefined);
  const expired = useRef(false);
  const clearUser = useCallback(() => {
    removeLegacyToken();
    setAccessToken(null);
    setToken(null);
    setRole('VIEWER');
    setName('');
    clockRef.current = null;
    setClock(null);
    setSessionActivityError(null);
  }, []);
  const logout = useCallback(() => {
    clearUser();
    setIsLoggingOut(true);
    void logoutSession()
      .catch(() => {
        /* The persistent marker blocks silent restoration. */
      })
      .finally(() => setIsLoggingOut(false));
  }, [clearUser]);
  const ensureClock = useCallback(() => {
    if (clockRef.current) return;
    const initial = sessionClock(fallbackSession());
    clockRef.current = initial;
    setClock(initial);
    setRemaining(sessionRemaining(initial));
  }, []);
  useEffect(() => {
    initializeSessionCoordination();
    let mounted = true;
    const expire = (event: Event) => {
      const code = (event as CustomEvent<string>).detail;
      if (code === 'SESSION_IDLE_EXPIRED')
        setSessionNotice('You were signed out after a period of inactivity. Please sign in again.');
      else if (code === 'SESSION_ABSOLUTE_EXPIRED')
        setSessionNotice('Your session reached its time limit. Please sign in again.');
      else if (code === 'SESSION_INVALID')
        setSessionNotice('Your session is no longer valid. Please sign in again.');
      clearUser();
    };
    const metadata = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const session = readBrowserSession(detail?.session ?? detail);
      if (!session || hasLogoutIntent()) return;
      const previous = clockRef.current;
      if (previous && Date.parse(session.serverTime) < Date.parse(previous.session.serverTime))
        return;
      const current = sessionClock(
        session,
        Number.isFinite(detail?.receivedAt) ? detail.receivedAt : Date.now(),
      );
      clockRef.current = current;
      setClock(current);
      setRemaining(sessionRemaining(current));
      setSessionActivityError(null);
    };
    const logoutChanged = () =>
      setLogoutProblem(['pending', 'failed'].includes(logoutState() || ''));
    const refreshed = (event: Event) => {
      const current = (event as CustomEvent<string>).detail;
      const attempt = authGeneration();
      if (mounted && getAccessToken() === current && !hasLogoutIntent()) {
        setToken(current);
        ensureClock();
      }
      void api
        .get('/auth/me')
        .then(({ data }) => {
          if (mounted && isCurrentAuth(attempt) && getAccessToken() === current) {
            setRole(data.data.role);
            setName(data.data.name || 'User');
            publishSession(data.session);
          }
        })
        .catch(() => {
          if (mounted && getAccessToken() === current) setRole('VIEWER');
        });
    };
    window.addEventListener('auth:expired', expire);
    window.addEventListener('auth:session', metadata);
    window.addEventListener('auth:logout-state', logoutChanged);
    window.addEventListener('auth:refreshed', refreshed);
    removeLegacyToken();
    if (csrfToken() && canBootstrapSession()) {
      const attempt = authGeneration();
      refreshSession()
        .then(async (saved) => {
          const { data } = await api.get('/auth/me');
          if (
            mounted &&
            isCurrentAuth(attempt) &&
            getAccessToken() === saved &&
            !hasLogoutIntent()
          ) {
            setRole(data.data.role);
            setName(data.data.name || 'User');
            setToken(saved);
            publishSession(data.session);
            ensureClock();
          }
        })
        .catch(() => {
          if (mounted && isCurrentAuth(attempt)) clearUser();
        })
        .finally(() => {
          if (mounted) setIsInitializing(false);
        });
    } else setIsInitializing(false);
    return () => {
      mounted = false;
      window.removeEventListener('auth:expired', expire);
      window.removeEventListener('auth:session', metadata);
      window.removeEventListener('auth:logout-state', logoutChanged);
      window.removeEventListener('auth:refreshed', refreshed);
    };
  }, [clearUser, ensureClock]);
  useEffect(() => {
    if (!token) return;
    let mounted = true;
    let last = 0;
    const reconcile = () => {
      if (document.hidden || Date.now() - last < 5000) return;
      last = Date.now();
      const attempt = authGeneration();
      void api
        .get('/auth/me')
        .then(({ data }) => {
          if (mounted && isCurrentAuth(attempt) && getAccessToken() === token) {
            setRole(data.data.role);
            setName(data.data.name || 'User');
            publishSession(data.session);
          }
        })
        .catch(() => {
          if (mounted && getAccessToken() === token) setRole('VIEWER');
        });
    };
    const timer = setInterval(reconcile, 60_000);
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
        Math.max(0, claims.exp * 1000 - (clock ? sessionServerNow(clock) : Date.now())),
      );
      return () => clearTimeout(timer);
    } catch {
      clearUser();
    }
  }, [token, clock, clearUser]);
  useEffect(() => {
    if (!token || !clock) {
      expired.current = false;
      return;
    }
    const check = () => {
      if (hasLogoutIntent()) {
        setLogoutProblem(['pending', 'failed'].includes(logoutState() || ''));
        clearUser();
        return;
      }
      const value = sessionRemaining(clock);
      setRemaining(value);
      if (value > 0 || expired.current) return;
      expired.current = true;
      const absolute =
        Date.parse(clock.session.absoluteExpiresAt) <= Date.parse(clock.session.idleExpiresAt);
      setSessionNotice(
        absolute
          ? 'Your session reached its time limit. Please sign in again.'
          : 'You were signed out after a period of inactivity. Please sign in again.',
      );
      logout();
    };
    check();
    const timer = setInterval(check, 1000);
    window.addEventListener('focus', check);
    window.addEventListener('pageshow', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', check);
      window.removeEventListener('pageshow', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [token, clock, logout, clearUser]);
  const sendActivity = useCallback(async (force = false) => {
    if (!getAccessToken() || !clockRef.current || sessionRemaining(clockRef.current) <= 0) return;
    if (activityPending.current) return activityPending.current;
    if (!shouldSendActivity(lastActivity.current, Date.now(), force)) return;
    lastActivity.current = Date.now();
    const request = reportSessionActivity()
      .then(() => {})
      .catch((error) => {
        if (getAccessToken())
          setSessionActivityError(
            'Your session could not be extended. Check your connection and try again before it expires.',
          );
        throw error;
      })
      .finally(() => {
        activityPending.current = undefined;
      });
    activityPending.current = request;
    return request;
  }, []);
  useEffect(() => {
    if (!token) return;
    const activity = (event: Event) => {
      if (!event.isTrusted || document.hidden) return;
      // The warning requires an explicit choice; stray mouse movement cannot dismiss it.
      const current = clockRef.current;
      if (!current || sessionRemaining(current) <= current.session.warningSeconds * 1000) return;
      void sendActivity().catch(() => {});
    };
    const kinds = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    kinds.forEach((kind) => window.addEventListener(kind, activity, { passive: true }));
    return () => kinds.forEach((kind) => window.removeEventListener(kind, activity));
  }, [token, sendActivity]);
  const continueSession = async () => {
    setIsContinuingSession(true);
    try {
      await sendActivity(true);
    } finally {
      setIsContinuingSession(false);
    }
  };
  const login = async (username: string, password: string) => {
    setIsLoggingIn(true);
    try {
      const result = await apiLogin(username, password);
      const attempt = authGeneration();
      const { data } = await api.get('/auth/me');
      if (!isCurrentAuth(attempt) || getAccessToken() !== result.token || hasLogoutIntent())
        throw new Error('The session changed. Please sign in again.');
      setRole(data.data.role);
      setName(data.data.name || 'User');
      setToken(result.token);
      setLogoutProblem(false);
      setSessionNotice(null);
      lastActivity.current = Date.now();
      publishSession(data.session || result.session);
      ensureClock();
    } catch (error) {
      clearUser();
      throw error;
    } finally {
      setIsLoggingIn(false);
    }
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
        sessionWarningSeconds:
          token && clock && remaining > 0 && remaining <= clock.session.warningSeconds * 1000
            ? Math.ceil(remaining / 1000)
            : null,
        continueSession,
        sessionActivityError,
        isContinuingSession,
        logoutProblem,
        isLoggingOut,
        sessionNotice,
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
