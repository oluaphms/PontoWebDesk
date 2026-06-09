import bcrypt from 'bcryptjs';
import { pool } from '../db/index.js';
import { generateTemporaryPassword } from '../security/passwords/generateTemporaryPassword.js';
import { BCRYPT_COST, validatePasswordWithPolicy } from '../security/passwords/passwordPolicy.js';
import { loadPasswordPolicyForCompany } from './passwordPolicySettings.service.js';
import { ensureAuthUserMirror, ensureUserForEmployee } from './employeeUserSync.js';

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

async function mirrorPasswordToAuth(params: {
  id: string;
  email: string;
  nome: string;
  role: string;
  companyId: string;
  passwordHash: string;
}): Promise<void> {
  await ensureAuthUserMirror(
    {
      id: params.id,
      email: params.email,
      nome: params.nome,
      role: params.role,
      companyId: params.companyId,
      passwordHash: params.passwordHash,
    },
    pool,
  );
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
  const passwordPolicy = await loadPasswordPolicyForCompany(companyId);
  const passwordIssue = validatePasswordWithPolicy(newPassword, passwordPolicy);
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
     returning id::text, nome, role`,
    [hash, email, companyId],
  );
  if ((userUpd.rowCount ?? 0) > 0) {
    const userId = String(userUpd.rows[0]?.id ?? '');
    if (await employeesHasPasswordHash()) {
      await pool.query(
        `update public.employees
         set password_hash = $1
         where lower(trim(email)) = $2 and company_id::text = $3`,
        [hash, email, companyId],
      );
    }
    if (userId) {
      await mirrorPasswordToAuth({
        id: userId,
        email,
        nome: String(userUpd.rows[0]?.nome ?? email),
        role: String(userUpd.rows[0]?.role ?? 'employee'),
        companyId,
        passwordHash: hash,
      });
    }
    return {
      ok: true,
      email,
      table: 'users',
      temporaryPassword: generatedTemporary ? newPassword : undefined,
      expiresAt,
    };
  }

  const employeeRow = await pool.query(
    `select id::text, nome, email, role, status, schedule_id, shift_id
     from public.employees
     where lower(trim(email)) = $1 and company_id::text = $2
     limit 1`,
    [email, companyId],
  );
  const employee = employeeRow.rows[0] as Record<string, unknown> | undefined;
  if (employee?.id) {
    await ensureUserForEmployee(
      {
        id: String(employee.id),
        company_id: companyId,
        nome: String(employee.nome || email),
        email,
        role: String(employee.role || 'employee'),
        status: String(employee.status || 'active'),
        schedule_id: employee.schedule_id,
        shift_id: employee.shift_id,
        password_hash: hash,
      },
      pool,
    );
    if (await employeesHasPasswordHash()) {
      await pool.query(
        `update public.employees
         set password_hash = $1
         where id::text = $2 and company_id::text = $3`,
        [hash, String(employee.id), companyId],
      );
    }
    await mirrorPasswordToAuth({
      id: String(employee.id),
      email,
      nome: String(employee.nome || email),
      role: String(employee.role || 'employee'),
      companyId,
      passwordHash: hash,
    });
    return {
      ok: true,
      email,
      table: 'employees',
      temporaryPassword: generatedTemporary ? newPassword : undefined,
      expiresAt,
    };
  }

  return {
    ok: false,
    status: 404,
    error: 'Utilizador não encontrado nesta empresa.',
  };
}
