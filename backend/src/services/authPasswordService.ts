import bcrypt from 'bcryptjs';
import { pool } from '../db/index.js';
import { tableHasColumn } from '../db/schemaColumns.js';
import { BCRYPT_COST, validatePasswordWithPolicy } from '../security/passwords/passwordPolicy.js';
import { loadPasswordPolicyForCompany } from './passwordPolicySettings.service.js';

export type ChangeOwnPasswordResult =
  | { ok: true; email: string | null; table: 'users' | 'employees' }
  | { ok: false; status: number; error: string };

export async function changeOwnPassword(params: {
  companyId: string;
  userId: string;
  newPassword: string;
}): Promise<ChangeOwnPasswordResult> {
  const companyId = String(params.companyId || '').trim();
  const userId = String(params.userId || '').trim();
  const newPassword = String(params.newPassword || '');

  if (!companyId || !userId) {
    return { ok: false, status: 403, error: 'Sessão inválida.' };
  }
  const passwordPolicy = await loadPasswordPolicyForCompany(companyId);
  const passwordIssue = validatePasswordWithPolicy(newPassword, passwordPolicy);
  if (passwordIssue) {
    return { ok: false, status: 400, error: passwordIssue };
  }

  const hash = await bcrypt.hash(newPassword, BCRYPT_COST);
  const usersHasPasswordHash = await tableHasColumn('users', 'password_hash');
  const employeesHasPasswordHash = await tableHasColumn('employees', 'password_hash');

  if (usersHasPasswordHash) {
    const userUpd = await pool.query(
      `update public.users
       set password_hash = $1
       where id::text = $2
         and company_id::text = $3
       returning email`,
      [hash, userId, companyId],
    );
    if ((userUpd.rowCount ?? 0) > 0) {
      if (employeesHasPasswordHash) {
        await pool.query(
          `update public.employees
           set password_hash = $1
           where id::text = $2
             and company_id::text = $3`,
          [hash, userId, companyId],
        );
      }
      return { ok: true, email: userUpd.rows[0]?.email ?? null, table: 'users' };
    }
  }

  if (employeesHasPasswordHash) {
    const employeeUpd = await pool.query(
      `update public.employees
       set password_hash = $1
       where id::text = $2
         and company_id::text = $3
       returning email`,
      [hash, userId, companyId],
    );
    if ((employeeUpd.rowCount ?? 0) > 0) {
      if (usersHasPasswordHash) {
        await pool.query(
          `update public.users
           set password_hash = $1
           where id::text = $2
             and company_id::text = $3`,
          [hash, userId, companyId],
        );
      }
      return { ok: true, email: employeeUpd.rows[0]?.email ?? null, table: 'employees' };
    }
  }

  return { ok: false, status: 404, error: 'Usuário da sessão não encontrado nesta empresa.' };
}
