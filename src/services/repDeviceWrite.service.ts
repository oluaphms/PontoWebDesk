import { apiDelete, apiPatch, apiPost, ApiError } from './api';

export type RepDevicePatchPayload = {
  nome_dispositivo?: string;
  provider_type?: string | null;
  identifier_type?: string;
  fabricante?: string | null;
  modelo?: string | null;
  ip?: string | null;
  porta?: number | null;
  tipo_conexao?: string;
  ativo?: boolean;
  status?: string;
  config_extra?: Record<string, unknown>;
};

export type RepDeviceCreatePayload = RepDevicePatchPayload & {
  nome_dispositivo: string;
  company_id?: string;
};

function unwrapData<T>(data: unknown): T {
  if (data && typeof data === 'object' && 'data' in (data as Record<string, unknown>)) {
    return (data as { data: T }).data;
  }
  return data as T;
}

export async function patchRepDevice(
  deviceId: string,
  payload: RepDevicePatchPayload,
): Promise<Record<string, unknown>> {
  const data = await apiPatch(`/rep/devices/${encodeURIComponent(deviceId)}`, payload);
  return unwrapData<Record<string, unknown>>(data);
}

export async function createRepDevice(
  payload: RepDeviceCreatePayload,
): Promise<Record<string, unknown>> {
  const data = await apiPost('/rep/devices', payload);
  return unwrapData<Record<string, unknown>>(data);
}

export async function deleteRepDeviceApi(deviceId: string): Promise<void> {
  await apiDelete(`/rep/devices/${encodeURIComponent(deviceId)}`);
}

function repDeviceWriteErrorMessage(e: unknown): string {
  if (e instanceof ApiError && e.status === 404) {
    const body =
      e.body && typeof e.body === 'object' ? (e.body as Record<string, unknown>) : undefined;
    const code = String(body?.error ?? '').trim();
    const message = String(body?.message ?? '').trim();
    if (code === 'not_found' && !message) {
      return 'Backend na VPS desatualizado — execute git pull, npm run build no backend e pm2 restart pontoweb-api.';
    }
    if (message) return message;
  }
  if (e instanceof Error && e.message.trim()) return e.message.trim();
  return 'Falha ao salvar dispositivo.';
}

/** Atualiza status via rota já existente na VPS (POST force-sync?action=set_status). */
async function postRepDeviceStatus(deviceId: string, status: string): Promise<void> {
  const data = (await apiPost(`/rep/devices/${encodeURIComponent(deviceId)}/force-sync`, {
    action: 'set_status',
    status,
  })) as Record<string, unknown>;
  if (data?.ok === false) {
    throw new Error(String(data.error || data.message || 'Falha ao salvar status.'));
  }
  if (String(data?.status ?? '').trim() !== status) {
    throw new Error(
      'Backend na VPS desatualizado — execute git pull, npm run build no backend e pm2 restart pontoweb-api.',
    );
  }
}

/** Atualiza status após teste de conexão — não propaga erro (conexão já foi validada). */
export async function trySetRepDeviceStatus(
  deviceId: string,
  status: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await postRepDeviceStatus(deviceId, status);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: repDeviceWriteErrorMessage(e) };
  }
}

/** Atualiza status após teste de conexão ou sincronização. */
export async function setRepDeviceStatus(deviceId: string, status: string): Promise<void> {
  await postRepDeviceStatus(deviceId, status);
}
