import React, { createContext, useContext, useEffect, useState } from "react";
import { User } from "../types";
import { api, clearTokens, getStoredToken, setTokens } from "../api/client";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  loginWithPassword: (credentials: { identifier: string; password: string }) => Promise<void>;
  registerWithPassword: (data: {
    username: string;
    displayName: string;
    password: string;
    identifier?: string;
  }) => Promise<void>;
  loginAsGuest: () => Promise<void>;
  login: (payload: { destination: string; code: string; username?: string; displayName?: string }) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setLoading(false);
      return;
    }

    api.auth.getMe()
      .then((res) => {
        if (res.success && res.user) {
          setUser(res.user);
        }
      })
      .catch(() => {
        clearTokens();
        setUser(null);
      })
      .finally(() => {
        setLoading(false);
      });

    const handleExpired = () => {
      setUser(null);
    };
    window.addEventListener("auth:expired", handleExpired);
    return () => window.removeEventListener("auth:expired", handleExpired);
  }, []);

  const loginWithPassword = async (credentials: { identifier: string; password: string }) => {
    const res = await api.auth.login(credentials);
    if (res.success && res.user) {
      setTokens(res.accessToken, res.refreshToken);
      setUser(res.user);
    }
  };

  const registerWithPassword = async (data: {
    username: string;
    displayName: string;
    password: string;
    identifier?: string;
  }) => {
    const res = await api.auth.register(data);
    if (res.success && res.user) {
      setTokens(res.accessToken, res.refreshToken);
      setUser(res.user);
    }
  };

  const loginAsGuest = async () => {
    const res = await api.auth.guest();
    if (res.success && res.user) {
      setTokens(res.accessToken, res.refreshToken);
      setUser(res.user);
    }
  };

  const login = async (payload: { destination: string; code: string; username?: string; displayName?: string }) => {
    const res = await api.auth.verifyOtp(payload);
    if (res.success && res.user) {
      setTokens(res.accessToken, res.refreshToken);
      setUser(res.user);
    }
  };

  const logout = async () => {
    try {
      await api.auth.logout();
    } catch {
      // Ignore network errors on logout
    } finally {
      clearTokens();
      setUser(null);
    }
  };

  const updateUser = (updated: User) => {
    setUser(updated);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        loginWithPassword,
        registerWithPassword,
        loginAsGuest,
        login,
        logout,
        updateUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
};
