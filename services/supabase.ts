/**
 * Supabase Configuration and Initialization
 *
 * Só inicializa o client quando VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
 * estão definidos (.env.local localmente ou variáveis na Vercel).
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getAppBaseUrl } from './appUrl';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || '';
const configured = !!(supabaseUrl && supabaseAnonKey);

export const isSupabaseConfigured = configured;

// Log imediato se variáveis faltando ou URL suspeita (evita timeout por URL errada)
if (typeof console !== 'undefined') {
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error(
      '❌ [Supabase] Variáveis de ambiente não encontradas. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env.local e reinicie o servidor (npm run dev).',
    );
    console.error(
      '❌ Se VITE_SUPABASE_URL estiver errado, o sistema fica tentando conectar indefinidamente e gera exatamente o erro de timeout.',
    );
  } else if (!supabaseUrl.startsWith('https://') || !supabaseUrl.includes('.supabase.co')) {
    console.warn(
      '⚠️ [Supabase] VITE_SUPABASE_URL não parece uma URL válida do Supabase (esperado: https://xxxx.supabase.co). Verifique o .env.local.',
    );
  }
}

const notConfiguredMsg =
  'Supabase não configurado. Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env.local (local) ou nas variáveis de ambiente da Vercel (Settings → Environment Variables). Veja CONFIGURAR_SUPABASE.md.';

function notConfigured(): never {
  if (typeof console !== 'undefined') {
    console.error('❌', notConfiguredMsg);
  }
  throw new Error(notConfiguredMsg);
}

/**
 * Onde o Supabase guarda o JWT (sessão).
 * - localStorage (padrão): ao reabrir o site dias depois, o usuário continua logado — é o comportamento usual de “manter sessão”.
 * - sessionStorage: ao fechar a aba/janela, a sessão some; ao abrir de novo o link, pede login (melhor em PC compartilhado).
 * Defina VITE_SUPABASE_AUTH_STORAGE=session no build (ex.: Vercel) se quiser esse modo.
 */
const useSessionStorageForAuth =
  typeof import.meta !== 'undefined' &&
  String(import.meta.env?.VITE_SUPABASE_AUTH_STORAGE || '').toLowerCase() === 'session';

const authStorage =
  typeof window !== 'undefined'
    ? {
        getItem: (key: string) => {
          const store = useSessionStorageForAuth ? window.sessionStorage : window.localStorage;
          return Promise.resolve(store.getItem(key));
        },
        setItem: (key: string, value: string) => {
          const store = useSessionStorageForAuth ? window.sessionStorage : window.localStorage;
          store.setItem(key, value);
          return Promise.resolve();
        },
        removeItem: (key: string) => {
          const store = useSessionStorageForAuth ? window.sessionStorage : window.localStorage;
          store.removeItem(key);
          return Promise.resolve();
        },
      }
    : undefined;

/**
 * Lock in-process (fila por nome) em vez do Web Locks API do navegador.
 * O lock padrão (`navigator.locks`) + React 18 Strict Mode (mount duplo) gera
 * locks órfãos → "steal" → AbortError em getSession/getUser. Ver:
 * https://github.com/supabase/supabase-js — opção `auth.lock`.
 *
 * Nota: não coordena outras abas do mesmo site; risco baixo na prática; evita
 * spam de erros e falhas em settings/records no primeiro paint.
 */
function createInProcessAuthLock() {
  const tails = new Map<string, Promise<void>>();
  return <R,>(name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> => {
    const prev = tails.get(name) ?? Promise.resolve();
    const run: Promise<R> = prev.then(() => fn());
    tails.set(
      name,
      run.then(
        () => undefined as void,
        () => undefined as void,
      ),
    );
    return run;
  };
}

// Timeout por requisição HTTP (auth + REST). 15s equilibra cold start e evita espera infinita.
const SUPABASE_FETCH_TIMEOUT_MS = 15000;

let authExpiredEventPending = false;

let client: SupabaseClient | null = null;

/** Preenchido após createClient — serializa leituras e evita lock GoTrue "auth-token ... stolen". */
const authReadCoalescers: {
  getSession?: () => Promise<{ data: { session: unknown }; error: unknown }>;
} = {};

/** Instantâneo do carregamento da página: nas primeiras requisições o JWT pode ainda não estar anexado → 401 falso. */
const PAGE_LOAD_AT = typeof window !== 'undefined' ? Date.now() : 0;
/** Não disparar “sessão expirada” durante este intervalo (evita reload/flash ao iniciar). */
const AUTH_401_GRACE_MS = 4500;

// Wrapper de fetch com timeout. 401 em REST não desloga se a sessão ainda existir (evita logout por race no refresh/RLS).
const fetchWithTimeout = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
  Promise.race([
    fetch(input, init).then((res) => {
      if (typeof window !== 'undefined' && res.status === 401 && !authExpiredEventPending) {
        const u = String(input);
        if (u.includes('/rest/v1/') && !u.includes('/auth/v1/') && client) {
          void (async () => {
            // Durante a hidratação da sessão (localStorage/IndexedDB), o primeiro GET pode ir sem Bearer → 401.
            if (Date.now() - PAGE_LOAD_AT < AUTH_401_GRACE_MS) return;
            try {
              const read =
                authReadCoalescers.getSession?.() ??
                client!.auth.getSession() as Promise<{ data: { session: unknown }; error: unknown }>;
              let { data: { session } } = await read;
              if (session) return;
              await new Promise((r) => setTimeout(r, 200));
              const read2 =
                authReadCoalescers.getSession?.() ??
                client!.auth.getSession() as Promise<{ data: { session: unknown }; error: unknown }>;
              ({ data: { session } } = await read2);
              if (session) return;
            } catch {
              // segue: sessão inválida
            }
            authExpiredEventPending = true;
            try {
              window.dispatchEvent(new CustomEvent('supabase:auth-expired'));
            } catch {
              // ignora
            }
            setTimeout(() => {
              authExpiredEventPending = false;
            }, 3000);
          })();
        }
      }
      return res;
    }),
    new Promise<Response>((_, reject) =>
      setTimeout(() => reject(new Error('Supabase timeout')), SUPABASE_FETCH_TIMEOUT_MS),
    ),
  ]);
/** Leitura coalescida de getUser — preenchido após createClient (evita lock "auth-token ... stolen"). */
let authGetUserCoalescedImpl: (() => Promise<{ data: { user: unknown }; error: unknown }>) | null = null;

if (configured) {
  client = createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: authStorage,
      ...(typeof window !== 'undefined' ? { lock: createInProcessAuthLock() } : {}),
    },
    global: {
      fetch: fetchWithTimeout,
    },
  });

  let inFlightSession: Promise<{ data: { session: unknown }; error: unknown }> | null = null;
  let inFlightUser: Promise<{ data: { user: unknown }; error: unknown }> | null = null;

  authReadCoalescers.getSession = () => {
    if (!client) return Promise.resolve({ data: { session: null }, error: null });
    if (!inFlightSession) {
      inFlightSession = client.auth.getSession().finally(() => {
        inFlightSession = null;
      });
    }
    return inFlightSession;
  };

  authGetUserCoalescedImpl = () => {
    if (!client) return Promise.resolve({ data: { user: null }, error: null });
    if (!inFlightUser) {
      inFlightUser = client.auth.getUser().finally(() => {
        inFlightUser = null;
      });
    }
    return inFlightUser;
  };

  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV && typeof console !== 'undefined') {
    const u = (supabaseUrl || '').trim();
    console.log('[SmartPonto] Supabase configurado. URL:', u ? `${u.slice(0, 30)}...` : '(vazia)');
  }
}

export const supabase = client;

/** Timeout padrão para testes de conexão e operações (ms). */
const DEFAULT_CONNECTION_TIMEOUT_MS = 10000;

/**
 * Timeout para `db.select` (REST). 10s gerava falhas frequentes em rede lenta ou cold start do Supabase.
 * Mantém ainda um teto para não travar a UI indefinidamente.
 */
export const DB_SELECT_TIMEOUT_MS = 28000;

/** Testa se o projeto Supabase está acessível (rede, URL e chave). Usa tabela users ou employees. */
export async function testSupabaseConnection(
  timeoutMs: number = DEFAULT_CONNECTION_TIMEOUT_MS,
): Promise<{ ok: boolean; message?: string }> {
  if (!configured || !client) {
    return { ok: false, message: notConfiguredMsg };
  }
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), timeoutMs),
  );
  const tablesToTry = ['users', 'employees', 'companies'] as const;
  for (const table of tablesToTry) {
    try {
      const queryPromise = client.from(table).select('*').limit(1);
      const { error } = await Promise.race([queryPromise, timeoutPromise]);
      if (error && error.code !== 'PGRST116') {
        continue; // tabela inexistente ou outro erro – tenta próxima
      }
      if (typeof console !== 'undefined' && import.meta.env?.DEV) {
        console.log('[SmartPonto] Supabase connected (table:', table, ')');
      }
      return { ok: true };
    } catch (e: any) {
      if (e?.message === 'timeout') {
        return {
          ok: false,
          message:
            'O Supabase não respondeu a tempo. Causas comuns: (1) Projeto pausado — em supabase.com/dashboard abra o projeto e clique em "Restore" se aparecer pausado; aguarde 1–2 minutos e tente de novo. (2) Rede lenta ou bloqueada. (3) URL errada no .env.local (VITE_SUPABASE_URL deve ser https://xxxx.supabase.co). Clique em "Entrar" novamente ou use "Limpar sessão e tentar de novo".',
        };
      }
      // não é timeout, pode ser rede/outro – tenta próxima tabela
    }
  }
  return {
    ok: false,
    message:
      'Não foi possível conectar ao Supabase. Verifique VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env.local, reinicie o servidor (npm run dev) e tente novamente.',
  };
}

/**
 * Executa uma promise do Supabase com timeout. Útil para evitar travamento em redes lentas ou projeto pausado.
 * @param promise Promise retornada por supabase.from(...).select() etc.
 * @param ms Timeout em ms (padrão 10000).
 */
export async function withSupabaseTimeout<T>(
  promise: Promise<{ data: T; error: any }>,
  ms: number = DEFAULT_CONNECTION_TIMEOUT_MS,
): Promise<{ data: T; error: any }> {
  return Promise.race([
    promise,
    new Promise<{ data: null; error: { message: string } }>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `Supabase timeout (${ms}ms). O servidor pode estar pausado ou a rede está lenta.`,
            ),
          ),
        ms,
      ),
    ),
  ]);
}

// Stub auth when not configured: getCurrentUser → null, onAuthStateChange → no-op
const stubAuth = {
  signIn: async () => notConfigured(),
  signUp: async () => notConfigured(),
  signOut: async (_options?: { scope?: 'local' | 'global' | 'others' }) => {
    console.warn('Supabase not configured - signOut ignored');
  },
  getUser: async () => {
    // Retornar null imediatamente se não configurado
    return Promise.resolve(null);
  },
  getSession: async () => Promise.resolve(null),
  onAuthStateChange: (_cb: (event: string, session: any) => void) => {
    // Retornar função no-op que não faz nada
    return () => {};
  },
  resetPassword: async () => notConfigured(),
  updatePassword: async () => notConfigured(),
  signInWithOAuth: async () => notConfigured(),
};

const realAuth = configured
  ? {
      signIn: async (email: string, password: string) => {
        const normalizedEmail = (email || '').trim().toLowerCase();
        const normalizedPassword = password ?? '';
        if (!normalizedEmail || !normalizedPassword) {
          throw new Error('Informe e-mail e senha.');
        }
        const { data, error } = await client!.auth.signInWithPassword({
          email: normalizedEmail,
          password: normalizedPassword,
        });
        if (error) throw error;
        if (!data) throw new Error('Erro ao fazer login: dados não retornados');
        return data;
      },
      signUp: async (email: string, password: string, metadata?: any) => {
        const { data, error } = await client!.auth.signUp({
          email,
          password,
          options: { data: metadata },
        });
        if (error) throw error;
        if (!data) throw new Error('Erro ao criar conta: dados não retornados');
        return data;
      },
      signOut: async (options?: { scope?: 'local' | 'global' | 'others' }) => {
        try {
          const { error } = await client!.auth.signOut(options);
          if (error) throw error;
        } catch (e: any) {
          const msg = String(e?.message ?? '');
          if (e?.name === 'AbortError' || msg.includes('Lock broken') || msg.includes('stole')) {
            try {
              await client!.auth.signOut(options);
            } catch {
              // Ignorar falha ao limpar sessão
            }
            return;
          }
          throw e;
        }
      },
      getUser: async () => {
        const run = async (): Promise<any> => {
          const { data: { user }, error } = await (authGetUserCoalescedImpl?.() ?? client!.auth.getUser());
          if (error) throw error;
          return user;
        };
        try {
          return await run();
        } catch (e: any) {
          const msg = String(e?.message ?? '');
          if (e?.name === 'AbortError' || msg.includes('Lock broken') || msg.includes('stole')) {
            await new Promise((r) => setTimeout(r, 400));
            return run();
          }
          throw e;
        }
      },
      getSession: async () => {
        const run = async (): Promise<any> => {
          const { data: { session }, error } = await (authReadCoalescers.getSession?.() ??
            client!.auth.getSession());
          if (error) throw error;
          return session;
        };
        try {
          return await run();
        } catch (e: any) {
          const msg = String(e?.message ?? '');
          if (e?.name === 'AbortError' || msg.includes('Lock broken') || msg.includes('stole')) {
            await new Promise((r) => setTimeout(r, 400));
            return run();
          }
          throw e;
        }
      },
      onAuthStateChange: (callback: (event: string, session: any) => void) => {
        const { data } = client!.auth.onAuthStateChange(callback);
        const unsub = (data as { subscription?: { unsubscribe?: () => void }; unsubscribe?: () => void })?.subscription?.unsubscribe
          ?? (data as { unsubscribe?: () => void })?.unsubscribe;
        return typeof unsub === 'function' ? () => unsub() : () => {};
      },
      resetPassword: async (email: string, redirectTo?: string) => {
        const base = redirectTo?.replace(/\/reset-password\/?$/, '') || getAppBaseUrl();
        const to = redirectTo && redirectTo.startsWith('http') ? redirectTo : `${base}/reset-password`;
        const { error } = await client!.auth.resetPasswordForEmail(email, { redirectTo: to });
        if (error) throw error;
      },
      updatePassword: async (newPassword: string) => {
        const { error } = await client!.auth.updateUser({ password: newPassword });
        if (error) throw error;
      },
      signInWithOAuth: async (provider: 'google' | 'github' | 'azure' = 'google') => {
        const { data, error } = await client!.auth.signInWithOAuth({
          provider,
          options: {
            redirectTo: `${getAppBaseUrl()}/auth/callback`,
          },
        });
        if (error) throw error;
        return data;
      },
    }
  : stubAuth;

export const auth = realAuth;

// DB helpers – throw when not configured
const stubDb = {
  from: (_: string) => notConfigured(),
  insert: async () => notConfigured(),
  update: async () => notConfigured(),
  delete: async () => notConfigured(),
  select: async () => notConfigured(),
  subscribe: () => notConfigured(),
};

const realDb = configured
  ? {
      from: (table: string) => client!.from(table),
      insert: async (table: string, data: any) => {
        const { data: result, error } = await client!.from(table).insert(data).select();
        if (error) throw error;
        return result;
      },
      update: async (table: string, id: string, data: any) => {
        const { data: result, error } = await client!
          .from(table)
          .update({ ...data, updated_at: new Date().toISOString() })
          .eq('id', id)
          .select();
        if (error) throw error;
        if (!result?.length) {
          throw new Error(
            'Nenhuma linha foi atualizada (registro inexistente ou permissão negada). Verifique o ID e as políticas RLS da tabela.',
          );
        }
        return result[0];
      },
      delete: async (table: string, id: string) => {
        const { error } = await client!.from(table).delete().eq('id', id);
        if (error) throw error;
      },
      select: async (
        table: string,
        filters?: { column: string; operator: string; value: any }[],
        orderBy?: { column: string; ascending?: boolean },
        limit?: number
      ) => {
        const run = async () => {
          let query = client!.from(table).select('*');
          if (filters) {
            filters.forEach((f) => {
              query = (query as any)[f.operator](f.column, f.value);
            });
          }
          if (orderBy) query = (query as any).order(orderBy.column, { ascending: orderBy.ascending ?? true });
          if (limit != null) query = (query as any).limit(limit);
          const { data, error } = await query;
          if (error) throw error;
          return data;
        };
        try {
          return await Promise.race([
            run(),
            new Promise<never>((_, reject) =>
              setTimeout(
                () =>
                  reject(
                    new Error(
                      `Tempo esgotado ao carregar dados (${Math.round(DB_SELECT_TIMEOUT_MS / 1000)}s). Verifique a rede ou tente novamente.`,
                    ),
                  ),
                DB_SELECT_TIMEOUT_MS,
              ),
            ),
          ]);
        } catch (e: any) {
          if (import.meta.env?.DEV && typeof console !== 'undefined') {
            console.warn('[db.select]', table, e?.message ?? e);
          }
          throw e;
        }
      },
      subscribe: (table: string, callback: (payload: any) => void, filters?: string) => {
        const ch = client!
          .channel(`${table}_changes`)
          .on('postgres_changes', { event: '*', schema: 'public', table, filter: filters }, callback)
          .subscribe();
        return () => client!.removeChannel(ch);
      },
    }
  : stubDb;

export const db = realDb;

// Storage – throw when not configured
const stubStorage = {
  upload: async () => notConfigured(),
  getPublicUrl: () => notConfigured(),
  download: async () => notConfigured(),
  delete: async () => notConfigured(),
  list: async () => notConfigured(),
};

const realStorage = configured
  ? {
      upload: async (bucket: string, path: string, file: File) => {
        const { data, error } = await client!.storage.from(bucket).upload(path, file, {
          cacheControl: '3600',
          upsert: false,
        });
        if (error) throw error;
        return data;
      },
      getPublicUrl: (bucket: string, path: string) =>
        client!.storage.from(bucket).getPublicUrl(path).data.publicUrl,
      download: async (bucket: string, path: string) => {
        const { data, error } = await client!.storage.from(bucket).download(path);
        if (error) throw error;
        return data;
      },
      delete: async (bucket: string, paths: string[]) => {
        const { error } = await client!.storage.from(bucket).remove(paths);
        if (error) throw error;
      },
      list: async (bucket: string, path?: string) => {
        const { data, error } = await client!.storage.from(bucket).list(path);
        if (error) throw error;
        return data;
      },
    }
  : stubStorage;

export const storage = realStorage;

const RESET_SESSION_SIGNOUT_TIMEOUT_MS = 4000;

/**
 * Limpa apenas a sessão local (storage). Não chama o servidor — instantâneo.
 * Use após timeout de login para que o próximo "Entrar" funcione sem "Limpar sessão".
 */
export async function clearLocalAuthSession(): Promise<void> {
  try {
    if (client) await client.auth.signOut({ scope: 'local' });
  } catch {
    // Ignorar; em seguida limpar chaves sb- do sessionStorage se existirem
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        const keys: string[] = [];
        for (let i = 0; i < window.sessionStorage.length; i++) {
          const k = window.sessionStorage.key(i);
          if (k && k.startsWith('sb-')) keys.push(k);
        }
        keys.forEach((k) => window.sessionStorage.removeItem(k));
      }
    } catch {
      // ignora
    }
  }
}

/**
 * Limpa sessão quebrada (timeout, projeto pausado, token corrompido).
 * Tenta signOut no Supabase com timeout curto; se o servidor estiver indisponível,
 * não trava: limpa storage e recarrega a página mesmo assim.
 */
export async function resetSession(): Promise<void> {
  try {
    if (client) {
      await Promise.race([
        client.auth.signOut(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('signOut timeout')), RESET_SESSION_SIGNOUT_TIMEOUT_MS)
        ),
      ]);
    }
  } catch {
    // Servidor indisponível ou timeout: segue para limpar storage e recarregar
  }
  try {
    if (typeof localStorage !== 'undefined') localStorage.clear();
    if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
  } catch {
    // ignora
  }
  if (typeof window !== 'undefined') window.location.reload();
}

export default supabase;
