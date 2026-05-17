import { getSupabase } from '../../services/supabaseClient';
import { handleError } from '../utils/handleError';
import { queryCache, TTL, buildTenantQueryCacheKey } from './queryCache';
import { JOB_TITLE_LIST_COLUMNS } from './egressSelectColumns';

/** Cargos / funções (`job_titles`). */
export async function getJobTitles(companyId: string) {
  const supabase = getSupabase();
  if (!supabase) return [];
  const cacheKey = buildTenantQueryCacheKey({ companyId }, 'job_titles', 'list');
  return queryCache.getOrFetch(
    cacheKey,
    async () => {
      const { data, error } = await supabase
        .from('job_titles')
        .select(JOB_TITLE_LIST_COLUMNS)
        .eq('company_id', companyId)
        .limit(500);
      if (error) {
        handleError(error, 'getJobTitles');
        return [];
      }
      return data ?? [];
    },
    TTL.STATIC,
  );
}
