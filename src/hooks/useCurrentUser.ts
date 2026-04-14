import { useEffect, useSyncExternalStore } from 'react';
import { User } from '../../types';
import { authService } from '../../services/authService';
import { getUserProfileStorage, checkSupabaseConfigured } from '../../services/supabase';

/** Se getCurrentUser travar, libera a UI (perfil em cache continua visível). */
const HYDRATE_FALLBACK_MS = 35000;

function getStoredUser(): User | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = getUserProfileStorage().getItem('current_user');
    if (!raw) return null;
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

/** Perfil em cache (mesmo storage da sessão). */
export function readCachedUser(): User | null {
  return getStoredUser();
}

type CurrentUserStore = {
  user: User | null;
  loading: boolean;
};

function createInitialStore(): CurrentUserStore {
  const u = getStoredUser();
  return { user: u, loading: u === null };
}

let store: CurrentUserStore = createInitialStore();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function setStore(next: Partial<CurrentUserStore>) {
  store = { ...store, ...next };
  emit();
}

/** Uma hidratação global — evita dezenas de getCurrentUser ao trocar de rota. */
let hydratePromise: Promise<void> | null = null;

async function runHydrate(): Promise<void> {
  try {
    if (!checkSupabaseConfigured()) {
      setStore({ user: getStoredUser(), loading: false });
      return;
    }
    const u = await authService.getCurrentUser();
    setStore({ user: u ?? getStoredUser(), loading: false });
  } catch {
    setStore({ user: getStoredUser(), loading: false });
  }
}

function ensureHydrateStarted(): void {
  if (hydratePromise) return;
  hydratePromise = runHydrate();
}

function resetHydrateLock(): void {
  hydratePromise = null;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): CurrentUserStore {
  return store;
}

function getServerSnapshot(): CurrentUserStore {
  return { user: null, loading: true };
}

function syncFromStorage(): void {
  const next = getStoredUser();
  if (!next) {
    resetHydrateLock();
    setStore({ user: null, loading: false });
    return;
  }
  const prevId = store.user?.id;
  setStore({ user: next, loading: false });
  /** Novo login / troca de conta: nova hidratação. Mesmo usuário: cache já atualizado (evita spam em getCurrentUser). */
  if (prevId !== next.id) {
    resetHydrateLock();
    ensureHydrateStarted();
  }
}

/**
 * Perfil do usuário para páginas do portal — estado único compartilhado (sem N hidratações paralelas).
 */
export function useCurrentUser() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    ensureHydrateStarted();
  }, []);

  useEffect(() => {
    const onSync = () => syncFromStorage();
    window.addEventListener('storage', onSync);
    window.addEventListener('current_user_changed', onSync);
    return () => {
      window.removeEventListener('storage', onSync);
      window.removeEventListener('current_user_changed', onSync);
    };
  }, []);

  useEffect(() => {
    if (!state.loading) return;
    const t = window.setTimeout(() => {
      if (store.loading) {
        setStore({ loading: false, user: getStoredUser() });
      }
    }, HYDRATE_FALLBACK_MS);
    return () => window.clearTimeout(t);
  }, [state.loading]);

  return { user: state.user, loading: state.loading };
}
