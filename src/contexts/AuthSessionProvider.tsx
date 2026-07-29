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
import { fetchAuthMeSessionCheck } from '../services/authMe.service';
import { clearToken, getToken } from '../services/authToken';
import { setUnauthorizedHandler } from '../services/api';
import {
  isCommercialBlockedCode,
  redirectToLicenseBlocked,
} from '../services/commercialBlockRedirect';
import { isPostLoginQueryCooldownActive } from '../app/postLoginQueryGate';
import {
  disconnectAllOperationalRealtime,
  resumeOperationalRealtime,
} from '../services/dbHttp';
import { observabilityConsole } from '../shared/logger/observabilityConsole';
import { SMARTPONTO_PROFILE_ENRICHED_EVENT } from '../app/appShellBootstrap';
import {
  readInitialSessionUser,
  readUserFromProfileStore,
  setSessionUserCache,
  getSessionUserCache,
  clearStoredSessionUser,
  isAuthLogoutGuardActive,
} from './authSessionInternals';
import { normalizeUserRole } from '../utils/userRole';

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

function authFlowLog(event: string, detail?: Record<string, unknown>): void {
  observabilityConsole.info(`[AUTH-FLOW] ${event}`, detail ?? {});
}

function commitUser(
  setter: React.Dispatch<React.SetStateAction<User | null>>,
  next: User | null | ((prev: User | null) => User | null),
): void {
  setter((prev) => {
    const resolved = typeof next === 'function' ? next(prev) : next;
    const normalized =
      resolved == null
        ? null
        : { ...resolved, role: normalizeUserRole(resolved.role) };
    setSessionUserCache(normalized);
    return normalized;
  });
}

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => readInitialSessionUser());
  const [loading, setLoading] = useState(() => readInitialSessionUser() == null);
  const bootRefreshDoneRef = useRef(false);
  const refreshGenerationRef = useRef(0);

  const setSessionUser = useCallback((next: User | null | ((prev: User | null) => User | null)) => {
    let authenticated = false;
    commitUser(setUser, (prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      if (resolved) {
        authenticated = true;
        resumeOperationalRealtime();
      }
      return resolved;
    });
    if (authenticated) {
      // Invalida refresh()/boot /auth/me em voo — evita clearSession pós-login.
      refreshGenerationRef.current += 1;
      authFlowLog('AUTH SESSION COMMIT', {
        at: new Date().toISOString(),
        refreshGeneration: refreshGenerationRef.current,
        reason: 'set_session_user',
      });
    }
    setLoading(false);
  }, []);

  const clearSession = useCallback(() => {
    authFlowLog('AUTH LOGOUT', {
      source: 'AuthSessionProvider.clearSession',
      at: new Date().toISOString(),
    });
    refreshGenerationRef.current += 1;
    disconnectAllOperationalRealtime('auth_session_cleared');
    clearStoredSessionUser();
    setUser(null);
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    const generation = ++refreshGenerationRef.current;
    setLoading(true);
    try {
      const result = await fetchAuthMeSessionCheck();
      if (generation !== refreshGenerationRef.current) {
        authFlowLog('AUTH CHECK STALE', {
          generation,
          current: refreshGenerationRef.current,
          at: new Date().toISOString(),
          reason: 'superseded_by_login_or_newer_refresh',
        });
        return;
      }
      if (result.user) {
        setSessionUser(result.user);
        return;
      }
      if (result.invalidateSession) {
        authFlowLog('AUTH LOGOUT', {
          reason: result.reason ?? 'auth_me_invalidate',
          at: new Date().toISOString(),
        });
        clearToken();
        authFlowLog('TOKEN REMOVED', { reason: result.reason });
        clearSession();
        if (isCommercialBlockedCode(result.reason)) {
          redirectToLicenseBlocked();
        }
        return;
      }
      authFlowLog('AUTH CHECK TRANSIENT', { reason: result.reason ?? 'unknown' });
      if (getSessionUserCache() && getToken()) {
        setLoading(false);
        return;
      }
      setLoading(false);
    } catch (error) {
      if (generation !== refreshGenerationRef.current) return;
      authFlowLog('AUTH CHECK FAILED', {
        reason: error instanceof Error ? error.message : String(error),
        transient: true,
      });
      setLoading(false);
    }
  }, [clearSession, setSessionUser]);

  useEffect(() => {
    authFlowLog('AUTH PROVIDER INIT', {
      hasCachedUser: Boolean(readInitialSessionUser()),
      hasToken: Boolean(typeof window !== 'undefined'),
    });
  }, []);

  useEffect(() => {
    setUnauthorizedHandler((code) => {
      const normalized = String(code || '').trim();
      // Pós-login: 401 paralelo (token_revoked / missing_token) não pode derrubar sessão nova.
      if (
        isPostLoginQueryCooldownActive() &&
        (normalized === 'AUTH_TOKEN_REVOKED' ||
          normalized === 'token_revoked' ||
          normalized === 'AUTH_MISSING_TOKEN' ||
          normalized === 'missing_token')
      ) {
        authFlowLog('AUTH LOGOUT SUPPRESSED', {
          source: 'api.unauthorizedHandler',
          code: normalized,
          reason: 'post_login_cooldown',
          at: new Date().toISOString(),
        });
        return;
      }
      authFlowLog('AUTH LOGOUT', {
        source: 'api.unauthorizedHandler',
        code: normalized,
        at: new Date().toISOString(),
      });
      clearToken();
      authFlowLog('TOKEN REMOVED', { source: 'unauthorizedHandler', code: normalized });
      clearSession();
      if (isCommercialBlockedCode(normalized)) {
        redirectToLicenseBlocked();
      }
    });
    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

  useEffect(() => {
    if (bootRefreshDoneRef.current) return;
    // Painel Master não usa sessão operacional — evita GET /api/auth/me no boot.
    if (
      typeof window !== 'undefined' &&
      (window.location.pathname === '/master' ||
        window.location.pathname.startsWith('/master/'))
    ) {
      bootRefreshDoneRef.current = true;
      setLoading(false);
      return;
    }
    bootRefreshDoneRef.current = true;
    void refresh();
  }, [refresh]);

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
      if (stored) {
        authFlowLog('TOKEN LOADED', { source: 'profile_store', userId: stored.id });
        setSessionUser((prev) => {
          if (prev?.id && stored.id !== prev.id) return prev;
          return stored;
        });
      }
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
