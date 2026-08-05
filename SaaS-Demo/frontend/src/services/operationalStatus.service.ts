import { SYSTEM_CONFIG } from '../config/system';
import { apiGet } from './api';
import { degradedResponse } from './degraded';

export type OperationalDayStatusRow = {
  id: string;
  company_id: string;
  employee_id: string;
  employee_name?: string | null;
  date: string;
  status: 'ok' | 'incomplete' | 'inconsistent' | 'pending_rep' | 'error';
  total_records: number;
  total_rep_pending: number;
  issues: unknown;
  first_punch: string | null;
  last_punch: string | null;
  updated_at: string;
  created_at: string;
};

export async function fetchOperationalStatus(companyId: string): Promise<OperationalDayStatusRow[]> {
  if (SYSTEM_CONFIG.DATA_PROVIDER_MODE === 'LOCAL_API') {
    return degradedResponse<OperationalDayStatusRow[]>().data;
  }
  const cid = companyId.trim();
  if (!cid) return [];

  const body = await apiGet<{
    success?: boolean;
    data?: OperationalDayStatusRow[];
    error?: string;
  }>(`/operational/status?company_id=${encodeURIComponent(cid)}`);

  if (body.success === false) {
    throw new Error(body.error || 'Falha ao carregar status operacional');
  }

  return body.data ?? [];
}
