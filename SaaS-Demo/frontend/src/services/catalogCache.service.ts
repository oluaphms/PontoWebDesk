/**
 * Cache de catálogos estáticos por sessão (TTL longo + invalidação no CRUD).
 * Chaves unificadas: `{resource}:list:{companyId}` — mesma família de `invalidateCompanyListCaches`.
 */
import { db, type DbRow } from '../../services/supabaseClient';
import { queryCache, TTL } from './queryCache';
import {
  DEPARTMENT_LIST_COLUMNS,
  ESTRUTURA_LIST_COLUMNS,
  JOB_TITLE_LIST_COLUMNS,
} from './egressSelectColumns';

export type CatalogResource =
  | 'departments'
  | 'job_titles'
  | 'schedules'
  | 'work_shifts'
  | 'estruturas'
  | 'motivo_demissao'
  | 'cidades'
  | 'estados_civis';

export function catalogListCacheKey(resource: CatalogResource, companyId: string): string {
  return `${resource}:list:${String(companyId || '').trim()}`;
}

async function selectCatalog(
  table: CatalogResource,
  companyId: string,
  columns: string,
  orderColumn: string,
): Promise<DbRow[]> {
  const cid = String(companyId || '').trim();
  if (!cid) return [];
  return (
    ((await db.select(
      table,
      [{ column: 'company_id', operator: 'eq', value: cid }],
      {
        columns,
        limit: 1000,
        orderBy: { column: orderColumn, ascending: true },
      },
    )) as DbRow[]) ?? []
  );
}

export async function fetchCachedDepartments(companyId: string): Promise<DbRow[]> {
  const cid = String(companyId || '').trim();
  if (!cid) return [];
  return queryCache.getOrFetch(
    catalogListCacheKey('departments', cid),
    () => selectCatalog('departments', cid, DEPARTMENT_LIST_COLUMNS, 'name'),
    TTL.STATIC,
  );
}

export async function fetchCachedJobTitles(companyId: string): Promise<DbRow[]> {
  const cid = String(companyId || '').trim();
  if (!cid) return [];
  return queryCache.getOrFetch(
    catalogListCacheKey('job_titles', cid),
    () => selectCatalog('job_titles', cid, JOB_TITLE_LIST_COLUMNS, 'name'),
    TTL.STATIC,
  );
}

export async function fetchCachedEstruturas(companyId: string): Promise<DbRow[]> {
  const cid = String(companyId || '').trim();
  if (!cid) return [];
  return queryCache.getOrFetch(
    catalogListCacheKey('estruturas', cid),
    () => selectCatalog('estruturas', cid, ESTRUTURA_LIST_COLUMNS, 'codigo'),
    TTL.STATIC,
  );
}

export async function fetchCachedSchedules(companyId: string): Promise<DbRow[]> {
  const cid = String(companyId || '').trim();
  if (!cid) return [];
  return queryCache.getOrFetch(
    catalogListCacheKey('schedules', cid),
    () =>
      selectCatalog('schedules', cid, 'id,name,shift_id,company_id', 'name'),
    TTL.STATIC,
  );
}

export async function fetchCachedWorkShifts(companyId: string): Promise<DbRow[]> {
  const cid = String(companyId || '').trim();
  if (!cid) return [];
  return queryCache.getOrFetch(
    catalogListCacheKey('work_shifts', cid),
    () =>
      selectCatalog(
        'work_shifts',
        cid,
        'id,number,name,description,start_time,end_time,ativo,company_id',
        'name',
      ),
    TTL.STATIC,
  );
}

export async function fetchCachedMotivoDemissao(companyId: string): Promise<DbRow[]> {
  const cid = String(companyId || '').trim();
  if (!cid) return [];
  return queryCache.getOrFetch(
    catalogListCacheKey('motivo_demissao', cid),
    () => selectCatalog('motivo_demissao', cid, 'id,name,company_id', 'name'),
    TTL.STATIC,
  );
}

export async function fetchCachedCidades(companyId: string): Promise<DbRow[]> {
  const cid = String(companyId || '').trim();
  if (!cid) return [];
  return queryCache.getOrFetch(
    catalogListCacheKey('cidades', cid),
    () => selectCatalog('cidades', cid, 'id,name,company_id', 'name'),
    TTL.STATIC,
  );
}

export async function fetchCachedEstadosCivis(companyId: string): Promise<DbRow[]> {
  const cid = String(companyId || '').trim();
  if (!cid) return [];
  return queryCache.getOrFetch(
    catalogListCacheKey('estados_civis', cid),
    () => selectCatalog('estados_civis', cid, 'id,name,company_id', 'name'),
    TTL.STATIC,
  );
}

export async function fetchCachedCompanyRules(
  companyId: string,
): Promise<Record<string, unknown> | null> {
  const cid = String(companyId || '').trim();
  if (!cid) return null;
  return queryCache.getOrFetch(
    `company_rules:${cid}`,
    async () => {
      const rows = (await db.select(
        'company_rules',
        [{ column: 'company_id', operator: 'eq', value: cid }],
        { limit: 1 },
      )) as Record<string, unknown>[];
      return rows?.[0] ?? null;
    },
    TTL.STATIC,
  );
}
