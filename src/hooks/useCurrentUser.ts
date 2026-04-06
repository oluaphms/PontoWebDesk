import { useEffect, useState, useRef } from 'react';
import { User } from '../../types';
import { authService } from '../../services/authService';
import { isSupabaseConfigured } from '../../services/supabase';

/** Alinhado ao tempo de SELECT no Supabase (rede lenta); evita spinner eterno se getCurrentUser demorar. */
const HYDRATE_TIMEOUT_MS = 32000;

function getStoredUser(): User | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem('current_user');
    if (!raw) return null;
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

/** Perfil em cache (localStorage) para estado inicial sem bloquear a UI. */
export function readCachedUser(): User | null {
  return getStoredUser();
}

/**
 * Perfil do usuário para páginas do portal: alinha com Supabase Auth + localStorage.
 * Com `current_user` em cache, não exibe spinner — hidrata em background.
 */
export function useCurrentUser() {
  const [user, setUser] = useState<User | null>(() => getStoredUser());
  const [loading, setLoading] = useState(() => getStoredUser() === null);
  const hydratedRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    const applyStored = () => {
      if (!mounted) return;
      setUser(getStoredUser());
      setLoading(false);
    };

    const hydrate = async () => {
      if (hydratedRef.current) return;
      if (!isSupabaseConfigured) {
        applyStored();
        hydratedRef.current = true;
        return;
      }
      try {
        const u = await authService.getCurrentUser();
        if (mounted) {
          setUser(u);
          setLoading(false);
          hydratedRef.current = true;
        }
      } catch {
        applyStored();
        hydratedRef.current = true;
      }
    };

    void hydrate();

    window.addEventListener('storage', applyStored);
    window.addEventListener('current_user_changed', applyStored);

    const fallbackTimeout = window.setTimeout(() => {
      if (mounted) {
        setLoading(false);
        if (import.meta.env?.DEV && typeof console !== 'undefined') {
          console.warn('[useCurrentUser] fallback: encerrando loading após', HYDRATE_TIMEOUT_MS, 'ms');
        }
      }
    }, HYDRATE_TIMEOUT_MS);

    return () => {
      mounted = false;
      window.clearTimeout(fallbackTimeout);
      window.removeEventListener('storage', applyStored);
      window.removeEventListener('current_user_changed', applyStored);
    };
  }, []);

  return { user, loading };
}
