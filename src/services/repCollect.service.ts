/**
 * Coleta manual REP por intervalo (enfileira comando no agente local).
 */

export type RepCollectRequest = {
  device_id: string;
  company_id?: string;
  start_date: string;
  end_date: string;
  receive_scope?: 'date_range' | 'incremental';
};

export type RepCollectResponse = {
  success: boolean;
  command_id?: string;
  status?: string;
  message?: string;
  reused?: boolean;
  error?: string;
};

export async function enqueueRepCollect(
  accessToken: string,
  payload: RepCollectRequest,
): Promise<RepCollectResponse> {
  const res = await fetch('/api/rep/collect', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...payload,
      receive_scope: payload.receive_scope ?? 'date_range',
    }),
  });
  const data = (await res.json().catch(() => ({}))) as RepCollectResponse & { error?: string };
  if (!res.ok) {
    return { success: false, error: data.error || `HTTP ${res.status}` };
  }
  return data;
}
