import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { User } from '../../../types';
import { LoadingState } from '../../../components/UI';
import { useAuth } from '../../hooks/useAuth';
import { SYSTEM_CONFIG } from '../../config/system';

export type RequireAuthProps = {
  /** @deprecated Perfil vem de `useAuth()` — mantido para compatibilidade. */
  appUser?: User | null;
  children?: React.ReactNode;
};

/**
 * Única gate de sessão Supabase: getSession, loading, refresh inválido e redirect para /login (SPA).
 * RBAC fica em RoleGuard nos filhos.
 */
const RequireAuth: React.FC<RequireAuthProps> = ({ appUser: appUserProp, children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user: sessionUser } = useAuth();
  const appUser = appUserProp ?? sessionUser;
  const [sessionChecked, setSessionChecked] = useState(false);

  const loginNavigationIssuedRef = useRef(false);

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

  useEffect(() => {
    setSessionChecked(true);
  }, [appUser]);

  useEffect(() => {
    if (appUser) return;
    if (!sessionChecked) return;
    redirectToLogin('no_local_session');
  }, [appUser, sessionChecked, redirectToLogin]);

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

  if (!appUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <LoadingState message="A redirecionar…" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
      <LoadingState
        message="A carregar perfil…"
      />
    </div>
  );
};

export default RequireAuth;
