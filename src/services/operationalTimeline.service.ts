import { SYSTEM_CONFIG } from '../config/system';
import { degradedResponse } from './degraded';
import { getProvider } from './getProvider';

export type TimelineEventDTO = {
  id: string;
  type: string;
  timestamp: string;
  title: string;
  description: string | null;
  severity: string | null;
  metadata: Record<string, unknown>;
};

export async function fetchOperationalTimeline(
  companyId: string,
  employeeId: string,
  dateYmd: string,
): Promise<TimelineEventDTO[]> {
  if (SYSTEM_CONFIG.DATA_PROVIDER_MODE === 'LOCAL_API') {
    return degradedResponse<TimelineEventDTO[]>().data;
  }
  const cid = companyId.trim();
  const eid = employeeId.trim();
  const d = dateYmd.trim();
  if (!cid || !eid || !d) return [];

  const token = await getProvider().getAccessToken();
  if (!token) throw new Error('Sessão expirada. Faça login novamente.');

  const params = new URLSearchParams({
    company_id: cid,
    employee_id: eid,
    date: d,
  });

  const res = await fetch(`/api/operational/timeline?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: TimelineEventDTO[];
    error?: string;
  };

  if (!res.ok || body.success === false) {
    throw new Error(body.error || 'Falha ao carregar timeline');
  }

  return body.data ?? [];
}
