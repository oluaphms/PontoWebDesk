import { supabase } from './supabaseClient';

export type OperationalDayStatusRow = {
  id: string;
  company_id: string;
  employee_id: string;
  employee_name?: string | null;
  date: string;
  status: 'ok' | 'incomplete' | 'inconsistent' | 'pending_rep' | 'error';
  total_records: number;
  total_rep_pending: number;
  issues: unknown;
  first_punch: string | null;
  last_punch: string | null;
  updated_at: string;
  created_at: string;
};

export async function fetchOperationalStatus(companyId: string): Promise<OperationalDayStatusRow[]> {
  const cid = companyId.trim();
  if (!cid) return [];

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Sessão expirada. Faça login novamente.');
  }

  const res = await fetch(`/api/operational/status?company_id=${encodeURIComponent(cid)}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: OperationalDayStatusRow[];
    error?: string;
  };

  if (!res.ok || body.success === false) {
    throw new Error(body.error || 'Falha ao carregar status operacional');
  }

  return body.data ?? [];
}
