import { operationalCircuitBreaker } from '../../domain/operational/resilience';

export async function resilient__CONTEXT__Call<T>(fn: () => Promise<T>): Promise<T> {
  return operationalCircuitBreaker.execute({ key: '__CONTEXT__', fn, companyId: 'template' });
}
