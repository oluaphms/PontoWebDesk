import { useState } from 'react';
import { db, isSupabaseConfigured } from '../services/supabaseClient';
import { queryCache, TTL } from '../services/queryCache';
import { useAbortableAsyncEffect } from './useAbortableAsyncEffect';

export type CompanyEmployeeOption = {
  id: string;
  nome: string;
  department_id?: string;
};

export function useCompanyEmployees(companyId: string | undefined): {
  employees: CompanyEmployeeOption[];
  loadingEmployees: boolean;
} {
  const [employees, setEmployees] = useState<CompanyEmployeeOption[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);

  useAbortableAsyncEffect(
    async (isCancelled) => {
      if (!companyId || !isSupabaseConfigured()) {
        setEmployees([]);
        setLoadingEmployees(false);
        return;
      }

      setLoadingEmployees(true);
      try {
        const list = (await queryCache.getOrFetch(
          `users:${companyId}`,
          () => db.select('users', [{ column: 'company_id', operator: 'eq', value: companyId }]) as Promise<any[]>,
          TTL.NORMAL,
        )) as any[];
        if (isCancelled()) return;
        setEmployees(
          (list ?? []).map((u: any) => ({
            id: u.id,
            nome: u.nome || u.email || 'Sem nome',
            department_id: u.department_id || '',
          })),
        );
      } finally {
        if (!isCancelled()) setLoadingEmployees(false);
      }
    },
    [companyId],
  );

  return { employees, loadingEmployees };
}

export default useCompanyEmployees;
