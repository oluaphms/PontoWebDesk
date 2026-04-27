import { useEffect, useState, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../services/supabaseClient';
import { handleError } from '../utils/handleError';

export interface User {
  id: string;
  email?: string;
  nome?: string;
  role: 'admin' | 'hr' | 'employee';
  company_id?: string;
  /** Alias camelCase (rotas admin usam `user.companyId`). */
  companyId?: string;
  department_id?: string;
}

function mapRowToUser(row: Record<string, unknown>): User {
  const cid = String(row.company_id ?? (row as { companyId?: string }).companyId ?? '').trim();
  const roleRaw = String(row.role ?? 'employee').toLowerCase();
  const role: User['role'] =
    roleRaw === 'admin' || roleRaw === 'hr' || roleRaw === 'employee' || roleRaw === 'supervisor'
      ? (roleRaw === 'supervisor' ? 'hr' : (roleRaw as User['role']))
      : 'employee';
  return {
    id: String(row.id),
    email: row.email != null ? String(row.email) : undefined,
    nome: row.nome != null ? String(row.nome) : undefined,
    role,
    company_id: cid || undefined,
    companyId: cid || undefined,
    department_id: row.department_id != null ? String(row.department_id) : undefined,
  };
}

function minimalUserFromAuthSession(sessionUser: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
}): User {
  const meta = sessionUser.user_metadata || {};
  const app = sessionUser.app_metadata || {};
  const pick = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const cid =
    pick(meta.tenant_id) ||
    pick(meta.company_id) ||
    pick(meta.companyId) ||
    pick(app.company_id) ||
    pick(app.tenant_id);
  const roleRaw = String(meta.role || app.role || 'employee').toLowerCase();
  const role: User['role'] =
    roleRaw === 'admin' || roleRaw === 'hr' || roleRaw === 'employee'
      ? (roleRaw as User['role'])
      : roleRaw === 'supervisor'
        ? 'hr'
        : 'employee';
  const email = (sessionUser.email || '').trim();
  return {
    id: sessionUser.id,
    email: email || undefined,
    nome: (pick(meta.nome) || email.split('@')[0] || 'Usuário') as string,
    role,
    company_id: cid || undefined,
    companyId: cid || undefined,
  };
}

let cachedUser: User | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000;
const PROFILE_LOADING_MAX_MS = 5000;

/** Uma carga de perfil por vez em todo o app (vários `useCurrentUser` em paralelo). */
let loadUserInflight: Promise<void> | null = null;

function isAuthLockError(e: unknown): boolean {
  const name = (e as { name?: string })?.name ?? '';
  const msg = String((e as { message?: string })?.message ?? e ?? '');
  return (
    name === 'NavigatorLockAcquireTimeoutError' ||
    /lock:sb-.*auth-token|another request stole it|NavigatorLockAcquireTimeout/i.test(msg)
  );
}

async function getSessionResilient(): Promise<ReturnType<typeof supabase.auth.getSession>> {
  const delays = [0, 120, 280];
  let lastErr: unknown;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await new Promise((r) => setTimeout(r, delays[i]));
    try {
      return await supabase.auth.getSession();
    } catch (e) {
      lastErr = e;
      if (!isAuthLockError(e) || i === delays.length - 1) throw e;
    }
  }
  throw lastErr;
}

export function readCachedUser(): User | null {
  if (cachedUser && Date.now() - cacheTimestamp < CACHE_DURATION) {
    return cachedUser;
  }
  return null;
}

/** Sincroniza apenas o cache em memória — sem `setState` (várias instâncias do hook compartilham). */
async function runSharedLoadUser(): Promise<void> {
  try {
    if (import.meta.env.DEV) {
      console.info('[useCurrentUser] getSession start');
    }
    const {
      data: { session },
      error,
    } = await getSessionResilient();

    if (error || !session?.user) {
      if (import.meta.env.DEV) {
        console.info('[useCurrentUser] sem sessão', error?.message);
      }
      cachedUser = null;
      cacheTimestamp = 0;
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('*')
      .eq('id', session.user.id)
      .single();

    if (import.meta.env.DEV) {
      console.info('[useCurrentUser] profile fetch', {
        ok: !!profile && !profileError,
        code: profileError?.code,
      });
    }

    if (profileError || !profile) {
      const minimal = minimalUserFromAuthSession(session.user);
      cachedUser = minimal;
      cacheTimestamp = Date.now();
      if (import.meta.env.DEV) {
        console.warn(
          '[useCurrentUser] public.users indisponível; usando sessão Auth (companyId pode ficar vazio até sincronizar).',
          profileError?.message,
        );
      }
    } else {
      const u = mapRowToUser(profile as Record<string, unknown>);
      cachedUser = u;
      cacheTimestamp = Date.now();
    }
  } catch (e) {
    handleError(e, 'useCurrentUser.loadUser');
    cachedUser = null;
    cacheTimestamp = 0;
  }
}

export function useCurrentUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }

    if (!loadUserInflight) {
      loadUserInflight = runSharedLoadUser().finally(() => {
        loadUserInflight = null;
      });
    }
    await loadUserInflight;
    setUser(readCachedUser());
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }

    // Verificar sessão no localStorage primeiro (mais rápido que getSession em mobile)
    const checkLocalSession = () => {
      try {
        const sessionStr = localStorage.getItem('sb-' + supabase.supabaseUrl + '-auth-token');
        if (sessionStr) {
          const session = JSON.parse(sessionStr);
          if (session?.user) {
            // Sessão existe, carregar rapidamente
            const minimal = minimalUserFromAuthSession(session.user);
            setUser(minimal);
          }
        }
      } catch {
        // Ignora erro, vai tentar via API normal
      }
    };
    
    checkLocalSession();

    const loadingCap = window.setTimeout(() => {
      setLoading(false);
    }, PROFILE_LOADING_MAX_MS);

    void loadUser().finally(() => {
      window.clearTimeout(loadingCap);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // Agora processamos INITIAL_SESSION também para mobile ficar mais rápido
      if (event === 'SIGNED_OUT') {
        setUser(null);
        cachedUser = null;
        setLoading(false);
        return;
      }
      if (session?.user) {
        void loadUser();
      }
    });

    return () => {
      window.clearTimeout(loadingCap);
      subscription.unsubscribe();
    };
  }, [loadUser]);

  return { user, loading, refresh: loadUser };
}

export default useCurrentUser;
