import bcrypt from 'bcryptjs';
import { pool } from '../db/index.js';
import { tableHasColumn } from '../db/schemaColumns.js';
import { BCRYPT_COST, validatePasswordWithPolicy } from '../security/passwords/passwordPolicy.js';
import { loadPasswordPolicyForCompany } from './passwordPolicySettings.service.js';

export type CompleteRecoveryResult =
  | { ok: true; email: string | null }
  | { ok: false; status: number; error: string };

async function fetchSupabaseAuthUser(
  accessToken: string,
): Promise<{ id: string; email: string | null } | null> {
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!supabaseUrl || !anonKey) return null;

  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { id?: string; email?: string | null };
  if (!user?.id) return null;
  return { id: String(user.id), email: user.email != null ? String(user.email) : null };
}

export async function completePasswordRecovery(params: {
  accessToken: string;
  newPassword: string;
}): Promise<CompleteRecoveryResult> {
  const accessToken = String(params.accessToken || '').trim();
  const newPassword = String(params.newPassword || '');
  if (!accessToken || !newPassword) {
    return { ok: false, status: 400, error: 'Token e nova senha são obrigatórios.' };
  }

  const authUser = await fetchSupabaseAuthUser(accessToken);
  if (!authUser) {
    return { ok: false, status: 401, error: 'Link inválido, expirado ou já utilizado.' };
  }

  const email = authUser.email?.trim().toLowerCase() || '';
  const userRow = await pool.query(
    `select id::text as id, company_id::text as company_id
     from public.users
     where id::text = $1
        or ($2 <> '' and lower(trim(email)) = $2)
     order by case when id::text = $1 then 0 else 1 end
     limit 1`,
    [authUser.id, email],
  );
  const row = userRow.rows[0] as { id?: string; company_id?: string } | undefined;
  if (!row?.id || !row?.company_id) {
    return { ok: false, status: 404, error: 'Usuário não encontrado na base da aplicação.' };
  }

  const passwordPolicy = await loadPasswordPolicyForCompany(String(row.company_id));
  const passwordIssue = validatePasswordWithPolicy(newPassword, passwordPolicy);
  if (passwordIssue) {
    return { ok: false, status: 400, error: passwordIssue };
  }

  const hash = await bcrypt.hash(newPassword, BCRYPT_COST);
  const usersHasPasswordHash = await tableHasColumn('users', 'password_hash');
  const employeesHasPasswordHash = await tableHasColumn('employees', 'password_hash');

  if (usersHasPasswordHash) {
    await pool.query(
      `update public.users set password_hash = $1 where id::text = $2 and company_id::text = $3`,
      [hash, row.id, row.company_id],
    );
  }
  if (employeesHasPasswordHash) {
    await pool.query(
      `update public.employees set password_hash = $1 where id::text = $2 and company_id::text = $3`,
      [hash, row.id, row.company_id],
    );
  }

  return { ok: true, email: authUser.email };
}
