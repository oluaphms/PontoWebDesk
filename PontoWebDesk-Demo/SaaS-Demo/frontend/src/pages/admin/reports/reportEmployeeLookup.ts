import { db } from '../../../services/supabaseClient';

type EmployeeLike = { id: string; nome?: string | null; email?: string | null };

/** Mapa id → nome para colaboradores (API) e usuários vinculados (batidas / inconsistências). */
export async function buildEmployeeNameMap(
  companyId: string,
  apiEmployees: EmployeeLike[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const e of apiEmployees) {
    const label = String(e.nome || e.email || '').trim() || 'Sem nome';
    map.set(e.id, label);
  }
  try {
    const users = (await db.select(
      'users',
      [{ column: 'company_id', operator: 'eq', value: companyId }],
      { columns: 'id,nome,email', limit: 1000 },
    )) as { id?: string; nome?: string; email?: string }[];
    for (const u of users ?? []) {
      const id = String(u.id ?? '').trim();
      if (!id) continue;
      const label = String(u.nome || u.email || '').trim() || map.get(id) || 'Sem nome';
      map.set(id, label);
    }
  } catch {
    // Mantém mapa parcial da API de colaboradores.
  }
  return map;
}

export function reportCompanyLabel(user: { companyId?: string | null } | null | undefined): string {
  return 'Empresa';
}

export function nameFromMap(map: Map<string, string>, id: string | null | undefined): string {
  const key = String(id ?? '').trim();
  if (!key) return '—';
  return map.get(key) ?? `${key.slice(0, 8)}…`;
}
