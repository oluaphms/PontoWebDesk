import type { SupabaseClient } from '@supabase/supabase-js';

export type CallerContext = { userId: string; companyId: string; role: string };

/**
 * Valida JWT via Auth REST e carrega `company_id` e `role` em `public.users`.
 */
export async function getCallerContext(
  supabaseUrl: string,
  anonKey: string,
  serviceClient: SupabaseClient,
  jwt: string,
): Promise<CallerContext | null> {
  if (!anonKey || !jwt) return null;
  const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: anonKey },
  });
  if (!res.ok) return null;
  const authUser = await res.json();
  const userId = authUser?.id as string | undefined;
  if (!userId) return null;

  const { data: row } = await serviceClient.from('users').select('company_id, role').eq('id', userId).maybeSingle();
  const companyId = row?.company_id != null ? String(row.company_id) : '';
  const role = String(row?.role ?? '').toLowerCase();
  if (!companyId) return null;
  return { userId, companyId, role };
}

export function isAdminOrHr(role: string): boolean {
  return role === 'admin' || role === 'hr';
}
