import { apiDelete, apiPatch, apiPost } from './api';

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

/** Atualiza status após teste de conexão ou sincronização. */
export async function setRepDeviceStatus(deviceId: string, status: string): Promise<void> {
  await patchRepDevice(deviceId, { status });
}
