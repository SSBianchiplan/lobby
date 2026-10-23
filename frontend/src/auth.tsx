import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, tokenStore, type Session, type User } from "./api";

type AuthCtx = {
  user: User | null; ready: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (data: RegisterData) => Promise<User>;
  /** Troca de senha e "sair de todos" devolvem um token novo (os antigos deixam de valer). */
  applySession: (s: Session) => User;
  logout: () => void; refresh: () => Promise<void>;
};

export type RegisterData = {
  name: string; email: string; phone?: string; password: string; accept_terms: boolean;
  city?: string; level?: string; side?: string; hand?: string; marketing_opt_in?: boolean;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const qc = useQueryClient();

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) { setUser(null); setReady(true); return; }
    try { setUser(await api<User>("/api/me")); } catch { setUser(null); }
    setReady(true);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const onAuth = (r: Session) => { tokenStore.set(r.token); setUser(r.user); qc.invalidateQueries(); return r.user; };

  const value: AuthCtx = {
    user, ready, refresh, applySession: onAuth,
    login: async (email, password) => onAuth(await api("/api/auth/login", { method: "POST", json: { email, password } })),
    register: async (data) => onAuth(await api("/api/auth/register", { method: "POST", json: data })),
    logout: () => { tokenStore.set(null); setUser(null); qc.clear(); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth fora do AuthProvider");
  return ctx;
}
