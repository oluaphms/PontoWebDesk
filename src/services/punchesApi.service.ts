import { apiPost } from './apiClient';

export type PunchInput = {
  client_id?: string;
  user_id?: string;
  userId?: string;
  company_id?: string;
  companyId?: string;
  type: string;
  timestamp?: string;
  punch_hash?: string;
  [key: string]: unknown;
};

export type PunchResult = {
  success: boolean;
  duplicate?: boolean;
  id?: string;
  punch_hash?: string;
};

type PunchApiResponse = {
  ok?: boolean;
  result?: PunchResult;
  results?: Array<{ client_id?: string; success?: boolean; duplicate?: boolean; punch_hash?: string; result?: { id: string } }>;
  error?: string;
};

export async function registerPunch(payload: PunchInput): Promise<PunchResult> {
  const data = (await apiPost('/punches', payload)) as PunchApiResponse;
  if (!data?.ok) throw new Error(String(data?.error || 'Erro ao registrar batida'));
  return data.result ?? { success: false, punch_hash: '' };
}

export async function registerPunchBatch(punches: PunchInput[]): Promise<PunchApiResponse['results']> {
  const data = (await apiPost('/punches/batch', { punches })) as PunchApiResponse;
  if (!data?.ok) throw new Error(String(data?.error || 'Erro ao registrar batidas'));
  return data.results ?? [];
}
