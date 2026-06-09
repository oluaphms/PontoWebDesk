import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { pool } from '../db/index.js';
import { newTokenJti } from './tokenRevocationService.js';
import { tableHasColumn } from '../db/schemaColumns.js';
import { normalizeRole } from '../utils/authContext.js';
import { resolveAccessProfile } from '../utils/accessProfile.js';

export type AuthLoginRow = {
  id: string;
  email: string;
  nome: string;
  company_id: string;
  role: string;
  cargo: string | null;
  department_id: string | null;
  schedule_id: string | null;
  shift_id: string | null;
  phone: string | null;
  avatar: string | null;
  preferences: unknown;
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
    accessProfile: 'COLABORADOR' | 'ADMIN_RH';
    company_id: string;
    cargo: string | null;
    department_id: string | null;
    schedule_id: string | null;
    shift_id: string | null;
    phone: string | null;
    avatar: string | null;
    preferences: unknown;
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
  const hasCargo = await tableHasColumn('users', 'cargo');
  const hasDepartment = await tableHasColumn('users', 'department_id');
  const hasSchedule = await tableHasColumn('users', 'schedule_id');
  const hasShift = await tableHasColumn('users', 'shift_id');
  const hasPhone = await tableHasColumn('users', 'phone');
  const hasAvatar = await tableHasColumn('users', 'avatar');
  const hasPreferences = await tableHasColumn('users', 'preferences');
  const result = await pool.query(
    `select id::text,
            coalesce(nullif(trim(email), ''), $1) as email,
            coalesce(nullif(trim(nome), ''), nullif(trim(email), ''), $1) as nome,
            coalesce(nullif(trim(company_id::text), ''), '') as company_id,
            coalesce(nullif(trim(role), ''), 'employee') as role,
            ${hasCargo ? 'cargo' : 'null'} as cargo,
            ${hasDepartment ? 'department_id' : 'null'} as department_id,
            ${hasSchedule ? 'schedule_id' : 'null'} as schedule_id,
            ${hasShift ? 'shift_id' : 'null'} as shift_id,
            ${hasPhone ? 'phone' : 'null'} as phone,
            ${hasAvatar ? 'avatar' : 'null'} as avatar,
            ${hasPreferences ? 'preferences' : "'{}'::jsonb"} as preferences,
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
    cargo: row.cargo != null ? String(row.cargo) : null,
    department_id: row.department_id != null ? String(row.department_id) : null,
    schedule_id: row.schedule_id != null ? String(row.schedule_id) : null,
    shift_id: row.shift_id != null ? String(row.shift_id) : null,
    phone: row.phone != null ? String(row.phone) : null,
    avatar: row.avatar != null ? String(row.avatar) : null,
    preferences: row.preferences ?? {},
    password_hash: row.password_hash != null ? String(row.password_hash) : '',
    source: 'users',
    status: String(row.status || 'active'),
  };
}

async function findInEmployees(email: string): Promise<AuthLoginRow | null> {
  if (!(await employeesHasPasswordHash())) return null;
  const hasStatus = await tableHasColumn('employees', 'status');
  const hasCargo = await tableHasColumn('employees', 'cargo');
  const hasDepartment = await tableHasColumn('employees', 'department_id');
  const hasSchedule = await tableHasColumn('employees', 'schedule_id');
  const hasShift = await tableHasColumn('employees', 'shift_id');
  const hasPhone = await tableHasColumn('employees', 'phone');
  const hasTelefone = await tableHasColumn('employees', 'telefone');
  const hasAvatar = await tableHasColumn('employees', 'avatar');
  const hasPreferences = await tableHasColumn('employees', 'preferences');

  const result = await pool.query(
    `select id::text,
            coalesce(nullif(trim(email), ''), $1) as email,
            coalesce(nullif(trim(nome), ''), nullif(trim(email), ''), $1) as nome,
            coalesce(nullif(trim(company_id::text), ''), '') as company_id,
            coalesce(nullif(trim(role), ''), 'employee') as role,
            ${hasCargo ? 'cargo' : 'null'} as cargo,
            ${hasDepartment ? 'department_id' : 'null'} as department_id,
            ${hasSchedule ? 'schedule_id' : 'null'} as schedule_id,
            ${hasShift ? 'shift_id' : 'null'} as shift_id,
            ${hasPhone ? 'phone' : hasTelefone ? 'telefone' : 'null'} as phone,
            ${hasAvatar ? 'avatar' : 'null'} as avatar,
            ${hasPreferences ? 'preferences' : "'{}'::jsonb"} as preferences,
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
    cargo: row.cargo != null ? String(row.cargo) : null,
    department_id: row.department_id != null ? String(row.department_id) : null,
    schedule_id: row.schedule_id != null ? String(row.schedule_id) : null,
    shift_id: row.shift_id != null ? String(row.shift_id) : null,
    phone: row.phone != null ? String(row.phone) : null,
    avatar: row.avatar != null ? String(row.avatar) : null,
    preferences: row.preferences ?? {},
    password_hash: row.password_hash != null ? String(row.password_hash) : '',
    source: 'employees',
    status: String(row.status || 'active'),
  };
}

function hasStoredPasswordHash(row: AuthLoginRow | null | undefined): boolean {
  return Boolean(String(row?.password_hash ?? '').trim());
}

/** Prioriza users; se a senha estiver só em employees, reutiliza o hash sem bloquear o login. */
async function resolveLoginUser(email: string): Promise<AuthLoginRow | null> {
  const fromUsers = await findInUsers(email);
  const fromEmployees = await findInEmployees(email);
  if (!fromUsers && !fromEmployees) return null;

  const primary = fromUsers ?? fromEmployees!;
  const alternate = fromUsers ? fromEmployees : fromUsers;

  if (hasStoredPasswordHash(primary)) return primary;
  if (alternate && hasStoredPasswordHash(alternate)) {
    void repairLoginPasswordHash(primary, alternate.password_hash);
    return { ...primary, password_hash: alternate.password_hash };
  }
  return primary;
}

/** Reespelha hash de employees em users quando o cadastro ficou dessincronizado. */
async function repairLoginPasswordHash(user: AuthLoginRow, passwordHash: string): Promise<void> {
  const hash = String(passwordHash || '').trim();
  if (!hash || hasStoredPasswordHash(user)) return;
  try {
    if (user.source === 'users' || user.source === 'employees') {
      await pool.query(
        `update public.users
         set password_hash = $1
         where id::text = $2
           and company_id::text = $3
           and (password_hash is null or password_hash = '')`,
        [hash, user.id, user.company_id],
      );
    }
    if (await employeesHasPasswordHash()) {
      await pool.query(
        `update public.employees
         set password_hash = $1
         where id::text = $2
           and company_id::text = $3
           and (password_hash is null or password_hash = '')`,
        [hash, user.id, user.company_id],
      );
    }
  } catch {
    // auto-reparo não deve bloquear autenticação
  }
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

  const user = await resolveLoginUser(identifier);
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
  const normalizedRole = normalizeRole(user.role);
  const jti = newTokenJti();
  const token = jwt.sign(
    {
      sub: user.id,
      userId: user.id,
      companyId: user.company_id,
      role: normalizedRole,
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
      role: normalizedRole,
      accessProfile: resolveAccessProfile(normalizedRole),
      company_id: user.company_id,
      cargo: user.cargo,
      department_id: user.department_id,
      schedule_id: user.schedule_id,
      shift_id: user.shift_id,
      phone: user.phone,
      avatar: user.avatar,
      preferences: user.preferences,
    },
  };
}
