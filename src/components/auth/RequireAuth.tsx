import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { User } from '../../../types';
import { LoadingState } from '../../../components/UI';
import { getSupabaseClient } from '../../lib/supabaseClient';
import { checkSupabaseConfigured, clearBrokenSession } from '../../../services/supabase';

const PROFILE_WAIT_MS = 90_000;

function authDev(tag: '[AUTH INIT]' | '[AUTH READY]' | '[AUTH INVALID]' | '[AUTH REDIRECT]', detail?: Record<string, unknown>): void {
  if (!import.meta.env.DEV || typeof console === 'undefined') return;
  console.info(tag, detail ?? {});
}

function isInvalidRefreshLikeMessage(msg: string): boolean {
  const m = String(msg || '').toLowerCase();
  return (
    m.includes('invalid refresh token') ||
    m.includes('refresh token not found') ||
    m.includes('invalid_grant')
  );
}

export type RequireAuthProps = {
  /** Utilizador da aplicação (perfil); quando preenchido, liberta filhos. */
  appUser: User | null;
  children?: React.ReactNode;
};

/**
 * Única gate de sessão Supabase: getSession, loading, refresh inválido e redirect para /login (SPA).
 * RBAC fica em RoleGuard nos filhos.
 */
const RequireAuth: React.FC<RequireAuthProps> = ({ appUser, children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [hasSupabaseSession, setHasSupabaseSession] = useState(false);
  const [profileWaitExpired, setProfileWaitExpired] = useState(false);

  const loginNavigationIssuedRef = useRef(false);
  const profileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const authInitLoggedRef = useRef(false);
  const authReadyLoggedRef = useRef(false);

  const redirectToLogin = useCallback(
    (reason: string, options?: { hard?: boolean }) => {
      if (loginNavigationIssuedRef.current) {
        return;
      }
      loginNavigationIssuedRef.current = true;
      authDev('[AUTH REDIRECT]', { reason, to: '/login' });

      if (options?.hard && typeof window !== 'undefined') {
        window.location.replace(`${window.location.origin}/login`);
        return;
      }

      navigate('/login', { replace: true, state: { from: location.pathname } });
    },
    [navigate, location.pathname],
  );

  const handleSessionError = useCallback(
    async (message: string, source: string) => {
      if (!isInvalidRefreshLikeMessage(message)) return;
      authDev('[AUTH INVALID]', { source, message: message.slice(0, 120) });
      try {
        await clearBrokenSession();
      } catch {
        /* ignore */
      }
      redirectToLogin('invalid_refresh');
    },
    [redirectToLogin],
  );

  useEffect(() => {
    if (appUser) {
      authInitLoggedRef.current = false;
      if (!authReadyLoggedRef.current) {
        authReadyLoggedRef.current = true;
        authDev('[AUTH READY]', { userId: appUser.id, path: location.pathname });
      }
      setSessionChecked(true);
      setHasSupabaseSession(true);
      if (profileTimerRef.current) {
        clearTimeout(profileTimerRef.current);
        profileTimerRef.current = null;
      }
      return;
    }

    authReadyLoggedRef.current = false;
    if (!authInitLoggedRef.current) {
      authInitLoggedRef.current = true;
      authDev('[AUTH INIT]', { path: location.pathname });
    }

    if (!checkSupabaseConfigured()) {
      setSessionChecked(true);
      setHasSupabaseSession(false);
      return;
    }

    const client = getSupabaseClient();
    if (!client) {
      setSessionChecked(true);
      setHasSupabaseSession(false);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const { data, error } = await client.auth.getSession();
        if (cancelled) return;
        if (error?.message) {
          await handleSessionError(error.message, 'getSession');
          if (cancelled) return;
        }
        const ok = Boolean(data?.session?.user);
        setHasSupabaseSession(ok);
        setSessionChecked(true);
        if (ok) {
          profileTimerRef.current = setTimeout(() => {
            if (cancelled) return;
            setProfileWaitExpired(true);
          }, PROFILE_WAIT_MS);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await handleSessionError(msg, 'getSession_throw');
        if (!cancelled) {
          setHasSupabaseSession(false);
          setSessionChecked(true);
        }
      }
    })();

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === 'SIGNED_OUT' || !session) {
        setHasSupabaseSession(false);
        setSessionChecked(true);
      }
      if (session?.user) {
        setHasSupabaseSession(true);
        setSessionChecked(true);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      if (profileTimerRef.current) {
        clearTimeout(profileTimerRef.current);
        profileTimerRef.current = null;
      }
    };
  }, [appUser, handleSessionError, location.pathname]);

  useEffect(() => {
    if (appUser) return;
    if (!sessionChecked) return;
    if (!checkSupabaseConfigured() || !hasSupabaseSession) {
      redirectToLogin(!checkSupabaseConfigured() ? 'supabase_not_configured' : 'no_supabase_session');
    }
  }, [appUser, sessionChecked, hasSupabaseSession, redirectToLogin]);

  if (appUser) {
    return <>{children}</>;
  }

  if (!sessionChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <LoadingState message="A validar sessão…" />
      </div>
    );
  }

  if (!checkSupabaseConfigured() || !hasSupabaseSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <LoadingState message="A redirecionar…" />
      </div>
    );
  }

  if (profileWaitExpired) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-50 dark:bg-slate-950 px-6 text-center">
        <p className="text-slate-700 dark:text-slate-200 max-w-md text-sm">
          Não foi possível carregar o perfil. A sessão pode estar incompleta ou a rede está instável.
        </p>
        <button
          type="button"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          onClick={() => redirectToLogin('profile_timeout', { hard: false })}
        >
          Voltar ao login
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
      <LoadingState message="A carregar perfil…" />
    </div>
  );
};

export default RequireAuth;
