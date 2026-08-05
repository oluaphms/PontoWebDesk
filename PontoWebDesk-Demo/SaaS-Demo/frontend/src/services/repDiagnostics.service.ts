import { buildApiUrl } from './api';
import { getToken } from './authToken';

export type RepDiagnosisSnapshot = {
  rpc: { ok: boolean; exists_in_db: boolean; api_allowed: boolean; ingest_exists: boolean };
  controlid: { ok: boolean | null; note?: string };
  login: { ok: boolean | null; note?: string };
  load_users: { ok: boolean | null; last_error?: string | null; note?: string };
  last_collect: { ok: boolean; at: string | null };
  last_consolidation: {
    ok: boolean;
    at: string | null;
    failed?: boolean;
    error?: { code?: string | null; message?: string | null } | null;
  };
};

export type RepDiagnosticsResponse = {
  ok: boolean;
  agentOnline?: boolean;
  lastHeartbeat?: string | null;
  lastCollection?: string | null;
  recordsPendingPromotionToday?: number;
  diagnosis?: RepDiagnosisSnapshot;
  error?: string;
};

export async function fetchRepDiagnostics(
  companyId: string,
  deviceId?: string,
): Promise<RepDiagnosticsResponse> {
  const accessToken = getToken();
  if (!accessToken) {
    return { ok: false, error: 'Sessão expirada' };
  }
  const params = new URLSearchParams({ company_id: companyId });
  if (deviceId) params.set('device_id', deviceId);
  const res = await fetch(buildApiUrl(`/rep/diagnostics?${params.toString()}`), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await res.json().catch(() => ({}))) as RepDiagnosticsResponse;
  if (!res.ok) {
    return { ok: false, error: body.error || `HTTP ${res.status}` };
  }
  return body;
}
