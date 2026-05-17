import { getSupabase } from '../../services/supabaseClient';
import { handleError } from '../utils/handleError';
import { queryCache, TTL, buildTenantQueryCacheKey } from './queryCache';
import { DEPARTMENT_LIST_COLUMNS } from './egressSelectColumns';

export async function getDepartments(companyId: string) {
  const supabase = getSupabase();
  if (!supabase) return [];
  const cacheKey = buildTenantQueryCacheKey({ companyId }, 'departments', 'list');
  return queryCache.getOrFetch(
    cacheKey,
    async () => {
      const { data, error } = await supabase
        .from('departments')
        .select(DEPARTMENT_LIST_COLUMNS)
        .eq('company_id', companyId)
        .limit(500);
      if (error) {
        handleError(error, 'getDepartments');
        return [];
      }
      return data ?? [];
    },
    TTL.STATIC,
  );
}
