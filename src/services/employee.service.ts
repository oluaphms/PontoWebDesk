import { handleError } from '../utils/handleError';
import { cacheEmployees } from './localDb';
import {
  createEmployee,
  deleteEmployee,
  fetchEmployees,
  updateEmployee,
  type ApiEmployee,
} from './employeesApi.service';

export type { ApiEmployee };

export async function getEmployeesByCompany(companyId: string): Promise<ApiEmployee[]> {
  const cid = String(companyId || '').trim();
  if (!cid) return [];
  try {
    const rows = await fetchEmployees(cid);
    await cacheEmployees(rows as Array<Record<string, unknown>>);
    return rows;
  } catch (e) {
    handleError(e, 'getEmployeesByCompany');
    return [];
  }
}

/** @deprecated Use getEmployeesByCompany */
export const getUsersByCompany = getEmployeesByCompany;

/** @deprecated Alias — mesma fonte API */
export const getLegacyEmployeesByCompany = getEmployeesByCompany;

export { createEmployee, updateEmployee, deleteEmployee, fetchEmployees };
