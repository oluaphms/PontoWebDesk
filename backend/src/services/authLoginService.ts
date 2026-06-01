import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { pool } from '../db/index.js';
import { newTokenJti } from './tokenRevocationService.js';
import { tableHasColumn } from '../db/schemaColumns.js';

export type AuthLoginRow = {
  id: string;
  email: string;
  nome: string;
  company_id: string;
  role: string;
  password_hash: string;
  source: 'users' | 'employees';
  status: string;
};

export type AuthLoginSuccess = {
  token: string;
  user: {
    id: string;
    nome: string;
    email: string;
    role: string;
    company_id: string;
  };
};

export type AuthLoginFailure =
  | { status: 400; error: string }
  | { status: 401; error: string }
  | { status: 503; error: string };

function normalizeIdentifier(body: Record<string, unknown>): string {
  const raw = body?.identifier ?? body?.email;
  return resolveLoginIdentifier(String(raw ?? ''));
}

/** Atalhos de login (ex.: "admin" → admin@pontowebdesk.com) — alinhado ao frontend legado. */
export function resolveLoginIdentifier(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (lower === 'admin@smartponto.com') return 'admin@pontowebdesk.com';
  if (lower.includes('@')) return lower;
  if (lower === 'admin' || lower === 'administrador') return 'admin@pontowebdesk.com';
  if (lower === 'desenvolvedor' || lower === 'dev') return 'desenvolvedor@smartponto.com';
  if (lower === 'funcionario' || lower === 'funcionário') return 'funcionario@smartponto.com';
  return lower;
}

async function employeesHasPasswordHash(): Promise<boolean> {
  const r = await pool.query(
    `select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'employees' and column_name = 'password_hash'
     limit 1`,
  );
  return (r.rowCount ?? 0) > 0;
}

async function findInUsers(email: string): Promise<AuthLoginRow | null> {
  const hasStatus = await tableHasColumn('users', 'status');
  const result = await pool.query(
    `select id::text,
            coalesce(nullif(trim(email), ''), $1) as email,
            coalesce(nullif(trim(nome), ''), nullif(trim(email), ''), $1) as nome,
            coalesce(nullif(trim(company_id::text), ''), '') as company_id,
            coalesce(nullif(trim(role), ''), 'employee') as role,
            password_hash,
            ${hasStatus ? "coalesce(nullif(trim(status), ''), 'active')" : "'active'"} as status
     from users
     where lower(trim(email)) = $1
     limit 1`,
    [email],
  );
  const row = result.rows[0];
  if (!row?.id) return null;
  return {
    id: String(row.id),
    email: String(row.email || email),
    nome: String(row.nome || email),
    company_id: String(row.company_id || ''),
    role: String(row.role || 'employee'),
    password_hash: row.password_hash != null ? String(row.password_hash) : '',
    source: 'users',
    status: String(row.status || 'active'),
  };
}

async function findInEmployees(email: string): Promise<AuthLoginRow | null> {
  if (!(await employeesHasPasswordHash())) return null;
  const hasStatus = await tableHasColumn('employees', 'status');

  const result = await pool.query(
    `select id::text,
            coalesce(nullif(trim(email), ''), $1) as email,
            coalesce(nullif(trim(nome), ''), nullif(trim(email), ''), $1) as nome,
            coalesce(nullif(trim(company_id::text), ''), '') as company_id,
            coalesce(nullif(trim(role), ''), 'employee') as role,
            password_hash,
            ${hasStatus ? "coalesce(nullif(trim(status), ''), 'active')" : "'active'"} as status
     from employees
     where lower(trim(email)) = $1
     limit 1`,
    [email],
  );
  const row = result.rows[0];
  if (!row?.id) return null;
  return {
    id: String(row.id),
    email: String(row.email || email),
    nome: String(row.nome || email),
    company_id: String(row.company_id || ''),
    role: String(row.role || 'employee'),
    password_hash: row.password_hash != null ? String(row.password_hash) : '',
    source: 'employees',
    status: String(row.status || 'active'),
  };
}

export async function authenticateLogin(
  body: Record<string, unknown>,
): Promise<AuthLoginSuccess | AuthLoginFailure> {
  const identifier = normalizeIdentifier(body);
  const password = String(body?.password ?? '');

  if (!identifier || !password) {
    return { status: 400, error: 'Informe e-mail e senha.' };
  }

  const secret = String(process.env.JWT_SECRET || '').trim();
  if (!secret) {
    return { status: 503, error: 'JWT_SECRET não configurado no servidor.' };
  }

  const user = (await findInUsers(identifier)) ?? (await findInEmployees(identifier));
  if (!user) {
    return { status: 401, error: 'Usuário não encontrado' };
  }
  if (!user.company_id) {
    return { status: 401, error: 'Usuário sem empresa vinculada' };
  }
  if (user.status && user.status !== 'active') {
    return { status: 401, error: 'Usuário inativo' };
  }

  if (!user.password_hash) {
    return { status: 401, error: 'Usuário sem senha cadastrada' };
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return { status: 401, error: 'Senha inválida' };
  }

  const signOptions: SignOptions = {
    expiresIn: (process.env.JWT_EXPIRES_IN?.trim() || '2h') as SignOptions['expiresIn'],
  };
  const jti = newTokenJti();
  const token = jwt.sign(
    {
      sub: user.id,
      userId: user.id,
      companyId: user.company_id,
      role: user.role,
      jti,
    },
    secret,
    signOptions,
  );

  return {
    token,
    user: {
      id: user.id,
      nome: user.nome,
      email: user.email,
      role: user.role,
      company_id: user.company_id,
    },
  };
}
