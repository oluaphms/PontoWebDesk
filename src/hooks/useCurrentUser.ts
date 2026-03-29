import { useEffect, useState } from 'react';
import { User } from '../../types';
import { authService } from '../../services/authService';
import { isSupabaseConfigured } from '../../services/supabase';

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

/**
 * Perfil do usuário para páginas do portal: alinha com Supabase Auth + localStorage
 * (evita ficar preso em "Carregando..." quando só o cache local está vazio).
 */
export function useCurrentUser() {
  const [user, setUser] = useState<User | null>(() => getStoredUser());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const applyStored = () => {
      if (!mounted) return;
      setUser(getStoredUser());
      setLoading(false);
    };

    const hydrate = async () => {
      if (!isSupabaseConfigured) {
        applyStored();
        return;
      }
      try {
        const u = await authService.getCurrentUser();
        if (mounted) {
          setUser(u);
          setLoading(false);
        }
      } catch {
        applyStored();
      }
    };

    void hydrate();

    window.addEventListener('storage', applyStored);
    window.addEventListener('current_user_changed', applyStored);

    const fallbackTimeout = window.setTimeout(() => {
      if (mounted) setLoading(false);
    }, 4000);

    return () => {
      mounted = false;
      window.clearTimeout(fallbackTimeout);
      window.removeEventListener('storage', applyStored);
      window.removeEventListener('current_user_changed', applyStored);
    };
  }, []);

  return { user, loading };
}
