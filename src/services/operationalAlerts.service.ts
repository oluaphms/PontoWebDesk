import { SYSTEM_CONFIG } from '../config/system';
import { degradedResponse } from './degraded';
import { getProvider } from './getProvider';

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
  const token = await getProvider().getAccessToken();
  if (!token) throw new Error('Sessão expirada. Faça login novamente.');

  const res = await fetch(`/api/operational/alerts?company_id=${encodeURIComponent(cid)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: OperationalAlertRow[];
    error?: string;
  };

  if (!res.ok || body.success === false) {
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
  const token = await getProvider().getAccessToken();
  if (!token) throw new Error('Sessão expirada. Faça login novamente.');

  const res = await fetch(`/api/operational/alerts/${encodeURIComponent(id)}/resolve`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
  });

  const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
  if (!res.ok || body.success === false) {
    throw new Error(body.error || 'Não foi possível resolver o alerta');
  }
}
