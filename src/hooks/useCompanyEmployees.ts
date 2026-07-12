import { useMemo } from 'react';
import { useEmployees } from './useEmployees';

export type CompanyEmployeeOption = {
  id: string;
  nome: string;
  department_id?: string;
  email?: string;
  role?: string;
  status?: string;
};

/**
 * Lista de colaboradores da empresa — React Query + `fetchEmployees` (queryCache).
 * Mesma fonte / invalidação que `useEmployees` / `invalidateEmployeesQueries`.
 */
export function useCompanyEmployees(companyId: string | undefined): {
  employees: CompanyEmployeeOption[];
  loadingEmployees: boolean;
} {
  const { data, isLoading, isFetching } = useEmployees(companyId);

  const employees = useMemo<CompanyEmployeeOption[]>(
    () =>
      (data ?? []).map((u) => ({
        id: u.id,
        nome: u.nome || u.email || 'Sem nome',
        department_id: u.department_id ?? '',
        email: u.email ?? undefined,
        role: u.role,
        status: u.status,
      })),
    [data],
  );

  return {
    employees,
    loadingEmployees: Boolean(companyId) && (isLoading || (isFetching && employees.length === 0)),
  };
}

export default useCompanyEmployees;
