import { handleError } from '../utils/handleError';
import { fetchCachedJobTitles } from './catalogCache.service';

/** Cargos / funções (`job_titles`). */
export async function getJobTitles(companyId: string) {
  try {
    return await fetchCachedJobTitles(companyId);
  } catch (error) {
    handleError(error, 'getJobTitles');
    return [];
  }
}
