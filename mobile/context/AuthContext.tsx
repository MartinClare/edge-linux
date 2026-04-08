import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  apiFetch,
  clearStoredCredentials,
  clearStoredToken,
  getStoredCredentials,
  getStoredToken,
  setStoredCredentials,
  setStoredToken,
} from "@/lib/api";

export type AuthUser = { id: string; name: string; email: string; role: string };

type AuthState = {
  ready: boolean;
  token: string | null;
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);

  const loginWithCredentials = useCallback(async (email: string, password: string) => {
    const res = await apiFetch<{ accessToken: string; user: AuthUser }>("/api/mobile/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
      token: null,
    });
    if (!res.ok) return res;

    await Promise.all([
      setStoredToken(res.data.accessToken),
      setStoredCredentials(email.trim(), password),
    ]);
    setToken(res.data.accessToken);
    setUser(res.data.user);
    return res;
  }, []);

  const refreshUser = useCallback(async () => {
    const t = await getStoredToken();
    if (!t) {
      setUser(null);
      return;
    }
    const res = await apiFetch<{ user: AuthUser }>("/api/mobile/me", { token: t });
    if (res.ok) setUser(res.data.user);
    else {
      await clearStoredToken();
      setToken(null);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const t = await getStoredToken();
      setToken(t);
      if (t) {
        const res = await apiFetch<{ user: AuthUser }>("/api/mobile/me", { token: t });
        if (res.ok) setUser(res.data.user);
        else {
          await clearStoredToken();
          setToken(null);
          const saved = await getStoredCredentials();
          if (saved) {
            const autoLogin = await loginWithCredentials(saved.email, saved.password);
            if (!autoLogin.ok) {
              await clearStoredCredentials();
            }
          }
        }
      } else {
        const saved = await getStoredCredentials();
        if (saved) {
          const autoLogin = await loginWithCredentials(saved.email, saved.password);
          if (!autoLogin.ok) {
            await clearStoredCredentials();
          }
        }
      }
      setReady(true);
    })();
  }, [loginWithCredentials]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await loginWithCredentials(email, password);
    if (!res.ok) return { ok: false as const, message: res.error.message };
    return { ok: true as const };
  }, [loginWithCredentials]);

  const logout = useCallback(async () => {
    await Promise.all([clearStoredToken(), clearStoredCredentials()]);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ ready, token, user, login, logout, refreshUser }),
    [ready, token, user, login, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
