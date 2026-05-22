import { db } from '../../services/supabaseClient';
import { handleError } from '../utils/handleError';
import { isCloudEnabled } from './cloudService';
import { cloudFallback } from './cloudFallback';
import { cacheEmployees, listCachedEmployeesByCompany } from './localDb';
import { getProvider } from './getProvider';

export async function getUsersByCompany(companyId: string) {
  if (!isCloudEnabled()) {
    return cloudFallback(await listCachedEmployeesByCompany(companyId));
  }
  try {
    const provider = getProvider();
    const rows = await provider.getEmployees(companyId);
    await cacheEmployees(rows as Array<Record<string, unknown>>);
    return rows;
  } catch (e) {
    handleError(e, 'getUsersByCompany');
    return cloudFallback(await listCachedEmployeesByCompany(companyId));
  }
}

export async function getLegacyEmployeesByCompany(companyId: string) {
  if (!isCloudEnabled()) {
    return cloudFallback(await listCachedEmployeesByCompany(companyId));
  }
  try {
    const rows = await db.select('employees', [{ column: 'company_id', operator: 'eq', value: companyId }]);
    await cacheEmployees(rows as Array<Record<string, unknown>>);
    return rows;
  } catch (e) {
    handleError(e, 'getLegacyEmployeesByCompany');
    return cloudFallback(await listCachedEmployeesByCompany(companyId));
  }
}
