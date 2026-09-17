"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { AuthUserDTO } from "@mpesa/types";
import { authApi } from "./api";

interface AuthState {
  user: AuthUserDTO | null;
  accessToken: string | null;
  /** True until the initial silent-refresh attempt (on page load) has resolved. */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * The access token lives only in memory (component state) — never
 * localStorage — per docs/13-auth-architecture.md's XSS-exposure reasoning.
 * That means a page reload loses it, so on mount this silently calls
 * /auth/refresh, which works if the httpOnly refresh cookie is still valid.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUserDTO | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authApi
      .refresh()
      .then(async ({ accessToken: token }) => {
        setAccessToken(token);
        setUser(await authApi.me(token));
      })
      .catch(() => {
        // No valid session — normal for a first-time or logged-out visitor, not an error to surface.
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login(email, password);
    setAccessToken(res.accessToken);
    setUser(res.user);
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    await authApi.register(email, password);
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => undefined);
    setAccessToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, accessToken, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
