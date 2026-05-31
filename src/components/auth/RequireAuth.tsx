import { observabilityConsole } from '../../shared/logger/observabilityConsole';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { User } from '../../../types';
import { LoadingState } from '../../../components/UI';
import { useAuth } from '../../hooks/useAuth';

export type RequireAuthProps = {
  /** @deprecated Perfil vem de `useAuth()` — mantido para compatibilidade. */
  appUser?: User | null;
  children?: React.ReactNode;
};

/**
 * Gate de sessão: exige JWT válido (via refresh /auth/me) e perfil em useAuth().
 * RBAC fica em RoleGuard nos filhos.
 */
const RequireAuth: React.FC<RequireAuthProps> = ({ appUser: appUserProp, children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user: sessionUser, loading, refresh } = useAuth();
  const appUser = appUserProp ?? sessionUser;
  const [tokenChecked, setTokenChecked] = useState(false);

  const loginNavigationIssuedRef = useRef(false);

  const redirectToLogin = useCallback(
    (reason: string) => {
      if (loginNavigationIssuedRef.current) return;
      loginNavigationIssuedRef.current = true;
      if (import.meta.env?.DEV) {
        observabilityConsole.info('[AUTH REDIRECT]', { reason, to: '/login' });
      }
      navigate('/login', { replace: true, state: { from: location.pathname } });
    },
    [navigate, location.pathname],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!appUser && !loading) {
        await refresh();
      }
      if (!cancelled) setTokenChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [appUser, loading, refresh]);

  useEffect(() => {
    if (!tokenChecked || loading) return;
    if (!appUser) {
      redirectToLogin('no_session_user');
    }
  }, [appUser, tokenChecked, loading, redirectToLogin]);

  if (!tokenChecked || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <LoadingState message="A validar sessão…" />
      </div>
    );
  }

  if (appUser) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
      <LoadingState message="A redirecionar…" />
    </div>
  );
};

export default RequireAuth;
