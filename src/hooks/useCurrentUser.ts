import { useEffect, useState } from 'react';
import { User } from '../../types';

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

export function useCurrentUser() {
  const [user, setUser] = useState<User | null>(() => getStoredUser());
  // Se usuário já está no cache, não precisamos de loading real
  const [loading, setLoading] = useState(!getStoredUser());

  useEffect(() => {
    let mounted = true;

    const handleStorageChange = () => {
      if (!mounted) return;
      const u = getStoredUser();
      setUser(u);
      setLoading(false);
    };

    // Timeout de segurança fall-back
    const fallbackTimeout = setTimeout(() => {
      if (mounted && loading) setLoading(false);
    }, 2000);

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('current_user_changed', handleStorageChange);

    handleStorageChange();

    return () => {
      mounted = false;
      clearTimeout(fallbackTimeout);
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('current_user_changed', handleStorageChange);
    };
  }, [loading]);

  return { user, loading };
}

