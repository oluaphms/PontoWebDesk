/**
 * ⚠️ AUTH RULE — única fonte de verdade de sessão no app (P0).
 *
 * Não criar `useState(user)` em App ou páginas.
 * Não ler `current_user` do localStorage fora de `authSessionInternals.ts`.
 * Consumir via `useAuth()` ou `getAuthUserOutsideReact()` (serviços).
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { User } from '../../types';
import { authService } from '../../services/authService';
import { fetchAuthMe } from '../services/authMe.service';
import { getToken, clearToken } from '../services/authToken';
import { SMARTPONTO_PROFILE_ENRICHED_EVENT } from '../app/appShellBootstrap';
import {
  readInitialSessionUser,
  readUserFromProfileStore,
  setSessionUserCache,
  isAuthLogoutGuardActive,
} from './authSessionInternals';

export type AuthSession = {
  user: User | null;
  companyId: string | null;
  role: User['role'] | null;
  loading: boolean;
  setSessionUser: (next: User | null | ((prev: User | null) => User | null)) => void;
  clearSession: () => void;
  refresh: () => Promise<void>;
};

const AuthSessionContext = createContext<AuthSession | null>(null);

function commitUser(
  setter: React.Dispatch<React.SetStateAction<User | null>>,
  next: User | null | ((prev: User | null) => User | null),
): void {
  setter((prev) => {
    const resolved = typeof next === 'function' ? next(prev) : next;
    setSessionUserCache(resolved);
    return resolved;
  });
}

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => readInitialSessionUser());
  const [loading, setLoading] = useState(() => readInitialSessionUser() == null);
  const bootRefreshDoneRef = useRef(false);

  const setSessionUser = useCallback((next: User | null | ((prev: User | null) => User | null)) => {
    commitUser(setUser, next);
    setLoading(false);
  }, []);

  const clearSession = useCallback(() => {
    setSessionUserCache(null);
    setUser(null);
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      clearSession();
      return;
    }
    setLoading(true);
    try {
      const current = await fetchAuthMe();
      if (!current) {
        clearToken();
        clearSession();
        return;
      }
      setSessionUser(current);
    } catch {
      clearToken();
      clearSession();
    }
  }, [clearSession, setSessionUser]);

  useEffect(() => {
    if (bootRefreshDoneRef.current) return;
    bootRefreshDoneRef.current = true;
    if (!user) {
      void refresh();
    }
  }, [refresh, user]);

  useEffect(() => {
    const onEnrich = (e: Event) => {
      const ce = e as CustomEvent<User>;
      const next = ce.detail;
      if (!next?.id) return;
      setSessionUser((prev) => (prev?.id === next.id ? next : prev));
    };
    window.addEventListener(SMARTPONTO_PROFILE_ENRICHED_EVENT, onEnrich);
    return () => window.removeEventListener(SMARTPONTO_PROFILE_ENRICHED_EVENT, onEnrich);
  }, [setSessionUser]);

  useEffect(() => {
    const syncFromProfileStore = () => {
      if (isAuthLogoutGuardActive()) return;
      const stored = readUserFromProfileStore();
      if (stored) setSessionUser(stored);
    };
    window.addEventListener('current_user_changed', syncFromProfileStore);
    return () => window.removeEventListener('current_user_changed', syncFromProfileStore);
  }, [setSessionUser]);

  const value = useMemo<AuthSession>(
    () => ({
      user,
      companyId: user?.companyId ?? null,
      role: user?.role ?? null,
      loading,
      setSessionUser,
      clearSession,
      refresh,
    }),
    [user, loading, setSessionUser, clearSession, refresh],
  );

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

export function useAuthSessionContext(): AuthSession {
  const ctx = useContext(AuthSessionContext);
  if (!ctx) {
    throw new Error('useAuth deve ser usado dentro de AuthSessionProvider');
  }
  return ctx;
}

/** Compatível com `readCachedUser` legado no App. */
export function readCachedSessionUser(): User | null {
  return readInitialSessionUser();
}
