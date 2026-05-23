import { SYSTEM_CONFIG } from '../config/system';
import { apiGet, apiPatch } from './api';
import { degradedResponse } from './degraded';

export type OperationalAlertRow = {
  id: string;
  company_id: string;
  employee_id: string;
  employee_name?: string | null;
  date: string;
  alert_type: string;
  severity: string;
  message: string;
  metadata: Record<string, unknown>;
  resolved: boolean;
  resolved_at: string | null;
  created_at: string;
};

export async function fetchOperationalAlerts(companyId: string): Promise<OperationalAlertRow[]> {
  if (SYSTEM_CONFIG.DATA_PROVIDER_MODE === 'LOCAL_API') {
    return degradedResponse<OperationalAlertRow[]>().data;
  }
  const cid = companyId.trim();
  if (!cid) return [];
  const body = await apiGet<{
    success?: boolean;
    data?: OperationalAlertRow[];
    error?: string;
  }>(`/operational/alerts?company_id=${encodeURIComponent(cid)}`);

  if (body.success === false) {
    throw new Error(body.error || 'Falha ao carregar alertas');
  }

  return body.data ?? [];
}

export async function resolveOperationalAlert(alertId: string): Promise<void> {
  if (SYSTEM_CONFIG.DATA_PROVIDER_MODE === 'LOCAL_API') {
    return;
  }
  const id = alertId.trim();
  if (!id) throw new Error('ID do alerta inválido.');
  const body = await apiPatch<{ success?: boolean; error?: string }>(
    `/operational/alerts/${encodeURIComponent(id)}/resolve`,
    {},
  );
  if (body.success === false) {
    throw new Error(body.error || 'Não foi possível resolver o alerta');
  }
}
