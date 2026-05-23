import { useState } from 'react';
import { fetchEmployees } from '../services/employeesApi.service';
import { queryCache, TTL } from '../services/queryCache';
import { useAbortableAsyncEffect } from './useAbortableAsyncEffect';

export type CompanyEmployeeOption = {
  id: string;
  nome: string;
  department_id?: string;
  email?: string;
  role?: string;
  status?: string;
};

export function useCompanyEmployees(companyId: string | undefined): {
  employees: CompanyEmployeeOption[];
  loadingEmployees: boolean;
} {
  const [employees, setEmployees] = useState<CompanyEmployeeOption[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);

  useAbortableAsyncEffect(
    async (isCancelled) => {
      if (!companyId) {
        setEmployees([]);
        setLoadingEmployees(false);
        return;
      }

      setLoadingEmployees(true);
      try {
        const list = await queryCache.getOrFetch(
          `employees-api:${companyId}`,
          () => fetchEmployees(companyId),
          TTL.NORMAL,
        );
        if (isCancelled()) return;
        setEmployees(
          (list ?? []).map((u) => ({
            id: u.id,
            nome: u.nome || u.email || 'Sem nome',
            department_id: '',
            email: u.email ?? undefined,
            role: u.role,
            status: u.status,
          })),
        );
      } catch (e) {
        console.warn('[useCompanyEmployees] API:', e);
        if (!isCancelled()) setEmployees([]);
      } finally {
        if (!isCancelled()) setLoadingEmployees(false);
      }
    },
    [companyId],
  );

  return { employees, loadingEmployees };
}

export default useCompanyEmployees;
