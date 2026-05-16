import { supabase } from './supabaseClient';

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

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Sessão expirada. Faça login novamente.');

  const res = await fetch(`/api/operational-risk?company_id=${encodeURIComponent(cid)}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: CompanyRiskApiPayload;
    error?: string;
  };

  if (!res.ok || body.success === false || !body.data) {
    throw new Error(body.error || 'Falha ao carregar risco operacional');
  }

  return body.data;
}
