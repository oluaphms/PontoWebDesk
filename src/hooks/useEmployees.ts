import { useQuery } from '@tanstack/react-query';
import { apiQueryKeys } from '../lib/apiQueryKeys';
import { fetchEmployees } from '../services/employeesApi.service';

export function useEmployees(companyId: string | undefined) {
  return useQuery({
    queryKey: companyId ? apiQueryKeys.employees(companyId) : ['employees', 'none'],
    queryFn: () => fetchEmployees(companyId!),
    enabled: Boolean(companyId),
    staleTime: 60_000,
  });
}

export default useEmployees;
