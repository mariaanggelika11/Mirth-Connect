import React, { createContext, useState, useContext, ReactNode, useEffect } from "react";
import { login as apiLogin } from "../services/auth.api";

interface AuthContextType {
  token: string | null;
  isLoggedIn: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  isInitializing: boolean;
  isLoggingIn: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  useEffect(() => {
    const savedToken = localStorage.getItem("authToken");
    if (savedToken) {
      setToken(savedToken);
    }
    setIsInitializing(false);
  }, []);

  const login = async (username: string, password: string) => {
    setIsLoggingIn(true);
    try {
      const { token } = await apiLogin(username, password);
      localStorage.setItem("authToken", token);
      setToken(token);
    } catch (error) {
      throw error;
    } finally {
      setIsLoggingIn(false);
    }
  };

  const logout = () => {
    localStorage.removeItem("authToken");
    setToken(null);
  };

  return (
    <AuthContext.Provider
      value={{
        token,
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
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
};
