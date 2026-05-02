import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, getToken, setToken } from "../api";
import type { User } from "../types";

export type RegisterResult = { needsVerification: true; email: string };

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (p: { email: string; username: string; password: string; displayName?: string }) => Promise<RegisterResult>;
  logout: () => void;
  applyAuthResponse: (token: string, user: User) => void;
  setUserLocal: (u: User) => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = getToken();
    if (!t) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.login({ email, password });
    setToken(r.token);
    setUser(r.user);
  }, []);

  const register = useCallback(
    async (p: { email: string; username: string; password: string; displayName?: string }) => {
      const r = await api.register(p);
      setToken(null);
      setUser(null);
      return { needsVerification: true as const, email: r.email };
    },
    [],
  );

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const applyAuthResponse = useCallback((token: string, u: User) => {
    setToken(token);
    setUser(u);
  }, []);

  const setUserLocal = useCallback((u: User) => {
    setUser(u);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, applyAuthResponse, setUserLocal }),
    [user, loading, login, register, logout, applyAuthResponse, setUserLocal],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}
