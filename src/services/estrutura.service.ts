import { getSupabase } from '../../services/supabaseClient';
import { handleError } from '../utils/handleError';
import { queryCache, TTL, buildTenantQueryCacheKey } from './queryCache';
import { ESTRUTURA_LIST_COLUMNS } from './egressSelectColumns';

export async function getEstruturas(companyId: string) {
  const supabase = getSupabase();
  if (!supabase) return [];
  const cacheKey = buildTenantQueryCacheKey({ companyId }, 'estruturas', 'list');
  return queryCache.getOrFetch(
    cacheKey,
    async () => {
      const { data, error } = await supabase
        .from('estruturas')
        .select(ESTRUTURA_LIST_COLUMNS)
        .eq('company_id', companyId)
        .limit(500);
      if (error) {
        handleError(error, 'getEstruturas');
        return [];
      }
      return data ?? [];
    },
    TTL.STATIC,
  );
}
