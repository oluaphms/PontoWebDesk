import bcrypt from 'bcryptjs';
import { pool } from '../db/index.js';
import { generateTemporaryPassword } from '../security/passwords/generateTemporaryPassword.js';
import { BCRYPT_COST, validateStrongPassword } from '../security/passwords/passwordPolicy.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type SetPasswordResult =
  | { ok: true; email: string; table: 'users' | 'employees'; temporaryPassword?: string; expiresAt?: string }
  | { ok: false; status: number; error: string };

async function employeesHasPasswordHash(): Promise<boolean> {
  const r = await pool.query(
    `select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'employees' and column_name = 'password_hash'
     limit 1`,
  );
  return (r.rowCount ?? 0) > 0;
}

export async function setUserPasswordForTenant(params: {
  companyId: string;
  email: string;
  newPassword: string;
}): Promise<SetPasswordResult> {
  const companyId = String(params.companyId || '').trim();
  const email = String(params.email || '').trim().toLowerCase();
  const requestedPassword = String(params.newPassword || '');
  const generatedTemporary = !requestedPassword.trim();
  const newPassword = generatedTemporary ? generateTemporaryPassword() : requestedPassword;

  if (!companyId) {
    return { ok: false, status: 403, error: 'Empresa não identificada.' };
  }
  if (!email || !EMAIL_RE.test(email)) {
    return { ok: false, status: 400, error: 'E-mail inválido.' };
  }
  const passwordIssue = validateStrongPassword(newPassword);
  if (passwordIssue) {
    return { ok: false, status: 400, error: passwordIssue };
  }

  const hash = await bcrypt.hash(newPassword, BCRYPT_COST);
  const expiresAt = generatedTemporary
    ? new Date(Date.now() + Number(process.env.TEMP_PASSWORD_TTL_HOURS || 24) * 60 * 60 * 1000).toISOString()
    : undefined;

  const userUpd = await pool.query(
    `update public.users
     set password_hash = $1
     where lower(trim(email)) = $2
       and company_id::text = $3
     returning id::text`,
    [hash, email, companyId],
  );
  if ((userUpd.rowCount ?? 0) > 0) {
    if (await employeesHasPasswordHash()) {
      await pool.query(
        `update public.employees
         set password_hash = $1
         where lower(trim(email)) = $2 and company_id::text = $3`,
        [hash, email, companyId],
      );
    }
    return {
      ok: true,
      email,
      table: 'users',
      temporaryPassword: generatedTemporary ? newPassword : undefined,
      expiresAt,
    };
  }

  if (await employeesHasPasswordHash()) {
    const empUpd = await pool.query(
      `update public.employees
       set password_hash = $1
       where lower(trim(email)) = $2
         and company_id::text = $3
       returning id::text`,
      [hash, email, companyId],
    );
    if ((empUpd.rowCount ?? 0) > 0) {
      await pool.query(
        `update public.users u
         set password_hash = $1
         from public.employees e
         where lower(trim(e.email)) = $2
           and e.company_id::text = $3
           and u.id::text = e.id::text`,
        [hash, email, companyId],
      );
      return {
        ok: true,
        email,
        table: 'employees',
        temporaryPassword: generatedTemporary ? newPassword : undefined,
        expiresAt,
      };
    }
  }

  return {
    ok: false,
    status: 404,
    error: 'Utilizador não encontrado nesta empresa.',
  };
}
