import { apiPost } from './api';

export async function saveRepDevicePassword(params: {
  deviceId: string;
  password: string;
  repLogin?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const deviceId = String(params.deviceId || '').trim();
  const password = String(params.password || '').trim();
  if (!deviceId || !password) {
    return { ok: false, error: 'deviceId e senha são obrigatórios.' };
  }
  try {
    const data = (await apiPost(`/rep/devices/${encodeURIComponent(deviceId)}/credentials`, {
      password,
      rep_login: params.repLogin,
    })) as Record<string, unknown>;
    if (data?.ok === true) return { ok: true };
    return { ok: false, error: String(data?.error || data?.message || 'Falha ao salvar credencial.') };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
