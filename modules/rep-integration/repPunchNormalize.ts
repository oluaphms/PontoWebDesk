/** Partilhado entre `repPunchHttp` e `api/_shared/repPunchRpcLite` (evita duplicar regex/normalização). */

export interface RepPunchBody {
  pis?: string;
  cpf?: string;
  matricula?: string;
  data_hora: string;
  tipo_marcacao?: string;
  nsr?: number;
  device_id?: string;
  company_id: string;
}

const REP_DEVICE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeRepDeviceIdForRpc(deviceId: unknown): string | null {
  if (deviceId == null) return null;
  const s = String(deviceId).trim();
  if (!s) return null;
  return REP_DEVICE_UUID_RE.test(s) ? s : null;
}

export function normalizeRepPunchNsrForRpc(nsr: unknown): number | null {
  if (nsr == null || nsr === '') return null;
  if (typeof nsr === 'number' && Number.isFinite(nsr)) return Math.trunc(nsr);
  const digits = String(nsr).replace(/\D/g, '');
  if (!digits) return null;
  try {
    const n = Number(BigInt(digits));
    return Number.isSafeInteger(n) ? n : null;
  } catch {
    return null;
  }
}
