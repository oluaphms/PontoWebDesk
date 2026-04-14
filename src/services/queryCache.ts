/**
 * Cache em memória para queries do Supabase.
 * Evita re-fetches desnecessários ao navegar entre páginas.
 * Sem dependências externas — substitui React Query para os casos mais comuns.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

/** TTLs padrão por tipo de dado (ms) */
export const TTL = {
  /** Dados que mudam raramente: departamentos, cargos, escalas */
  STATIC: 5 * 60 * 1000,       // 5 min
  /** Dados que mudam com frequência moderada: funcionários, configurações */
  NORMAL: 60 * 1000,            // 1 min
  /** Dados em tempo real: registros de ponto, badges */
  REALTIME: 15 * 1000,          // 15 s
} as const;

export const queryCache = {
  get<T>(key: string): T | null {
    const entry = store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      store.delete(key);
      return null;
    }
    return entry.data;
  },

  set<T>(key: string, data: T, ttl: number): void {
    store.set(key, { data, expiresAt: Date.now() + ttl });
  },

  /**
   * Busca do cache ou executa o fetcher e armazena o resultado.
   * Deduplicação: chamadas simultâneas com a mesma key compartilham a mesma promise.
   */
  async getOrFetch<T>(key: string, fetcher: () => Promise<T>, ttl: number): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) return cached;

    // Deduplicação de chamadas em voo
    const inflight = inflightMap.get(key) as Promise<T> | undefined;
    if (inflight) return inflight;

    const promise = fetcher().then((data) => {
      this.set(key, data, ttl);
      inflightMap.delete(key);
      return data;
    }).catch((err) => {
      inflightMap.delete(key);
      throw err;
    });

    inflightMap.set(key, promise);
    return promise;
  },

  /** Invalida entradas que começam com o prefixo (ex: 'users:company123') */
  invalidate(prefix: string): void {
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) store.delete(key);
    }
  },

  /** Limpa todo o cache (ex: no logout) */
  clear(): void {
    store.clear();
    inflightMap.clear();
  },
};

const inflightMap = new Map<string, Promise<unknown>>();

/**
 * Chave estável para cache de relatórios admin (prefixo invalidado com `admin_report:${companyId}`).
 * Ex.: `adminReportCacheKey('co1', 'work_hours', '2026-04')` → `admin_report:co1:work_hours:2026-04`
 */
export function adminReportCacheKey(companyId: string, reportSlug: string, ...parts: string[]): string {
  return ['admin_report', companyId, reportSlug, ...parts].join(':');
}

/** Listas e KPIs admin (Dashboard, BankHours) — `users:`, `time_records:week:` e relatórios `admin_report:`. */
export function invalidateCompanyListCaches(companyId: string): void {
  if (!companyId) return;
  queryCache.invalidate(`users:${companyId}`);
  queryCache.invalidate(`time_records:week:${companyId}`);
  queryCache.invalidate(`admin_report:${companyId}`);
}

/**
 * Após batida de ponto: admin dashboard + dashboard do colaborador (registros recentes / banco de horas).
 */
export function invalidateAfterPunch(userId: string, companyId: string | undefined): void {
  if (!userId) return;
  if (companyId) {
    invalidateCompanyListCaches(companyId);
  }
  queryCache.invalidate(`time_records:user:${userId}`);
  queryCache.invalidate(`time_balance:${userId}`);
}

/**
 * Após fechar folha no Espelho de Ponto: atualiza saldos mensais, movimentos de banco de horas e KPIs admin.
 * Invalida caches com prefixo `admin_bank_hours:${companyId}` (Bank Hours) e todos os `time_balance:` (dashboard colaborador).
 */
export function invalidateAfterTimesheetMonthClose(companyId: string): void {
  if (!companyId) return;
  invalidateCompanyListCaches(companyId);
  queryCache.invalidate(`admin_bank_hours:${companyId}`);
  queryCache.invalidate('time_balance:');
}

/** Dashboard colaborador usa `requests:pending:${userId}` (ver pages/Dashboard.tsx). */
export function invalidatePendingRequestsCache(userId: string): void {
  if (!userId) return;
  queryCache.invalidate(`requests:pending:${userId}`);
}

/** Após criar/aprovar/excluir solicitação — invalida cache de todos os envolvidos (sem duplicar). */
export function invalidatePendingRequestsCachesForUsers(userIds: string[]): void {
  const seen = new Set<string>();
  for (const id of userIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    invalidatePendingRequestsCache(id);
  }
}
