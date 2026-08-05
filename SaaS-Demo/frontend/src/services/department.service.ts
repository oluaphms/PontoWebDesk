import { handleError } from '../utils/handleError';
import { fetchCachedDepartments } from './catalogCache.service';

export async function getDepartments(companyId: string) {
  try {
    return await fetchCachedDepartments(companyId);
  } catch (error) {
    handleError(error, 'getDepartments');
    return [];
  }
}
