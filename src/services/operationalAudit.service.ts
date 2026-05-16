import { supabase } from './supabaseClient';

export type OperationalAuditRow = {
  id: string;
  company_id: string;
  actor_id: string | null;
  actor_name?: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export async function fetchOperationalAudit(
  companyId: string,
  opts?: { entityType?: string; entityId?: string; limit?: number },
): Promise<OperationalAuditRow[]> {
  const cid = companyId.trim();
  if (!cid) return [];
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Sessão expirada. Faça login novamente.');

  const params = new URLSearchParams({ company_id: cid });
  if (opts?.entityType?.trim()) params.set('entity_type', opts.entityType.trim());
  if (opts?.entityId?.trim()) params.set('entity_id', opts.entityId.trim());
  if (opts?.limit != null) params.set('limit', String(opts.limit));

  const res = await fetch(`/api/operational-audit?${params.toString()}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: OperationalAuditRow[];
    error?: string;
  };

  if (!res.ok || body.success === false) {
    throw new Error(body.error || 'Falha ao carregar auditoria');
  }

  return body.data ?? [];
}
