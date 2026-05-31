import { observabilityConsole } from '../../../shared/logger/observabilityConsole';
import type { SupabaseClient } from '@supabase/supabase-js';
import { safeUserSelectColumns } from '../../../services/supabaseClient';
import type { EmployeeForRep } from './types';

/** Utilizadores da empresa para match REP (evita estado `employees` limitado a 200 linhas / outra company_id). */
export async function fetchRepMatchUsersForBlob(
  client: SupabaseClient,
  companyId: string,
): Promise<EmployeeForRep[]> {
  const cid = companyId.trim();
  const requested = [
    'id',
    'nome',
    'email',
    'status',
    'invisivel',
    'demissao',
    'pis',
    'cpf',
    'numero_identificador',
    'numero_folha',
    'pis_pasep',
    'company_id',
  ];
  const cols = await safeUserSelectColumns(client, requested);
  const { data, error } = await client.from('users').select(cols.join(',')).eq('company_id', cid).limit(5000);
  if (error) {
    observabilityConsole.error('[USERS QUERY ERROR]', error);
    return [];
  }

  if (!data?.length) return [];
  return (data as unknown as Record<string, unknown>[]).map((row) => ({
    id: String(row.id ?? ''),
    nome: String((row.nome as string) || (row.email as string) || row.id || '').trim(),
    status: String(row.status || 'active').trim(),
    invisivel: row.invisivel === true,
    demissao: (row.demissao as string) || null,
    company_id: String(row.company_id ?? cid),
    pis_pasep: (row.pis_pasep as string) ?? null,
    pis: (row.pis as string) ?? null,
    cpf: (row.cpf as string) ?? null,
    numero_identificador: (row.numero_identificador as string) ?? null,
    numero_folha: (row.numero_folha as string) ?? null,
  }));
}
