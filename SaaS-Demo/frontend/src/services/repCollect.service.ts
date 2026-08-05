/**
 * Coleta manual REP por intervalo (enfileira comando no agente local).
 */

import { apiPost } from './api';

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
  try {
    return (await apiPost(
      '/rep/collect',
      {
        ...payload,
        receive_scope: payload.receive_scope ?? 'date_range',
      },
      { headers: { Accept: 'application/json' } },
    )) as RepCollectResponse;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha na coleta REP';
    return { success: false, error: msg };
  }
}
