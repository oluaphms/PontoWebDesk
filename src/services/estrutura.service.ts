import { handleError } from '../utils/handleError';
import { fetchCachedEstruturas } from './catalogCache.service';

export async function getEstruturas(companyId: string) {
  try {
    return await fetchCachedEstruturas(companyId);
  } catch (error) {
    handleError(error, 'getEstruturas');
    return [];
  }
}
