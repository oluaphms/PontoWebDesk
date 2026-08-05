import { SYSTEM_CONFIG } from '../config/system';
import { apiGet } from './api';

export type CompanyRiskApiPayload = {
  risk: 'ok' | 'medium' | 'high' | 'critical';
  total_alerts: number;
  critical: number;
  high: number;
  high_threshold: number;
  medium_volume_threshold: number;
  sla: Record<string, unknown> | null;
};

export async function fetchOperationalRisk(companyId: string): Promise<CompanyRiskApiPayload> {
  if (SYSTEM_CONFIG.DATA_PROVIDER_MODE === 'LOCAL_API') {
    return {
      risk: 'ok',
      total_alerts: 0,
      critical: 0,
      high: 0,
      high_threshold: 3,
      medium_volume_threshold: 5,
      sla: null,
    };
  }
  const cid = companyId.trim();
  if (!cid) {
    return {
      risk: 'ok',
      total_alerts: 0,
      critical: 0,
      high: 0,
      high_threshold: 3,
      medium_volume_threshold: 5,
      sla: null,
    };
  }

  const body = await apiGet<{
    success?: boolean;
    data?: CompanyRiskApiPayload;
    error?: string;
  }>(`/operational/risk?company_id=${encodeURIComponent(cid)}`);

  if (body.success === false || !body.data) {
    throw new Error(body.error || 'Falha ao carregar risco operacional');
  }

  return body.data;
}
