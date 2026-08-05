import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { pool } from '../db/index.js';
import { logger } from '../logger/logger.js';
import { newTokenJti } from './tokenRevocationService.js';
import { tableHasColumn } from '../db/schemaColumns.js';
import { normalizeRole } from '../utils/authContext.js';
import { resolveAccessProfile } from '../utils/accessProfile.js';
import {
  isCommercialGateUnavailableError,
  readCompanySessionGate,
} from '../master/commercial/companySessionRevocation.js';

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
  must_change_password?: boolean;
};

export type AuthLoginSuccess = {
  token: string;
  user: {
    id: string;
    nome: string;
    email: string;
    role: string;
    accessProfile: 'COLABORADOR' | 'ADMIN_RH' | 'ADMIN_GERENTE';
    company_id: string;
    cargo: string | null;
    department_id: string | null;
    schedule_id: string | null;
    shift_id: string | null;
    phone: string | null;
    avatar: string | null;
    preferences: unknown;
    mustChangePassword?: boolean;
  };
};

export type AuthLoginFailure =
  | { status: 400; error: string }
  | { status: 401; error: string }
  | { status: 403; error: string; code?: string }
  | { status: 503; error: string; code?: string; detail?: string };

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
  const hasMustChangePassword = await tableHasColumn('users', 'must_change_password');
  // Bootstrap: ainda não há companyId na sessão; lookup pré-auth.
  const sql = `select id::text,
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
            ${hasMustChangePassword ? 'must_change_password' : 'false'} as must_change_password,
            password_hash,
            ${hasStatus ? "coalesce(nullif(trim(status), ''), 'active')" : "'active'"} as status
     from users
     where lower(trim(email)) = $1
     limit 1`;
  const result = await pool.queryTrustedBootstrap(sql, [email]);
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
    must_change_password: Boolean(row.must_change_password),
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

  const sql = `select id::text,
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
            false as must_change_password,
            password_hash,
            ${hasStatus ? "coalesce(nullif(trim(status), ''), 'active')" : "'active'"} as status
     from employees
     where lower(trim(email)) = $1
     limit 1`;
  const result = await pool.queryTrustedBootstrap(sql, [email]);
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
    must_change_password: false,
    password_hash: row.password_hash != null ? String(row.password_hash) : '',
    source: 'employees',
    status: String(row.status || 'active'),
  };
}

function hasStoredPasswordHash(row: AuthLoginRow | null | undefined): boolean {
  return Boolean(String(row?.password_hash ?? '').trim());
}

async function findAuthEncryptedPassword(email: string): Promise<string | null> {
  try {
    const tableExists = await pool.query(
      `select 1 from information_schema.tables
       where table_schema = 'auth' and table_name = 'users'
       limit 1`,
    );
    if ((tableExists.rowCount ?? 0) === 0) return null;
    const result = await pool.queryTrustedBootstrap(
      `select encrypted_password
       from auth.users
       where lower(trim(email)) = $1
       limit 1`,
      [email],
    );
    const hash = String(result.rows[0]?.encrypted_password ?? '').trim();
    return hash || null;
  } catch {
    return null;
  }
}

/** Prioriza users; se a senha estiver só em employees/auth, reutiliza o hash sem bloquear o login. */
async function resolveLoginUser(email: string): Promise<AuthLoginRow | null> {
  const emailNormalized = resolveLoginIdentifier(String(email || '').trim());
  const fromUsers = await findInUsers(emailNormalized);
  const fromEmployees = await findInEmployees(emailNormalized);
  if (!fromUsers && !fromEmployees) return null;

  const primary = fromUsers ?? fromEmployees!;
  const alternate = fromUsers ? fromEmployees : fromUsers;

  if (hasStoredPasswordHash(primary)) return primary;
  if (alternate && hasStoredPasswordHash(alternate)) {
    void repairLoginPasswordHash(primary, alternate.password_hash);
    return { ...primary, password_hash: alternate.password_hash };
  }
  const authHash = await findAuthEncryptedPassword(emailNormalized);
  if (authHash) {
    void repairLoginPasswordHash(primary, authHash);
    return { ...primary, password_hash: authHash };
  }
  return primary;
}

/** Reespelha hash de employees em users quando o cadastro ficou dessincronizado. */
async function repairLoginPasswordHash(user: AuthLoginRow, passwordHash: string): Promise<void> {
  const hash = String(passwordHash || '').trim();
  if (!hash || hasStoredPasswordHash(user)) return;
  try {
    if (user.source === 'users' || user.source === 'employees') {
      await pool.queryTrustedBootstrap(
        `update public.users
         set password_hash = $1
         where id::text = $2
           and company_id::text = $3
           and (password_hash is null or password_hash = '')`,
        [hash, user.id, user.company_id],
      );
    }
    if (await employeesHasPasswordHash()) {
      await pool.queryTrustedBootstrap(
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

const AUTH_INVALID_CREDENTIALS = 'Credenciais inválidas';

function commercialBlockLoginMessage(reason: string | null | undefined): string {
  const r = String(reason || '').trim();
  if (
    r === 'license_expired_by_master' ||
    r === 'license_validity_expired' ||
    r === 'subscription_expired_by_master'
  ) {
    return 'Licença expirada. Entre em contato com o suporte comercial para renovar o acesso.';
  }
  if (r === 'license_blocked_by_master' || r === 'license_block_login_by_master') {
    return 'Licença bloqueada pelo Painel Master. Entre em contato com o suporte comercial.';
  }
  return 'Acesso bloqueado pelo Painel Master. Entre em contato com o suporte comercial.';
}

/**
 * Bloqueio automático: usa apenas o estado comercial projetado pelo Master
 * (companies.commercial_blocked). Sem lógica comercial própria no SaaS.
 * Também lê company_session_version para embutir no JWT.
 */
async function readCompanyCommercialGateForLogin(
  companyId: string,
): Promise<{ blocked: boolean; reason: string | null; sessionVersion: number }> {
  const gate = await readCompanySessionGate(companyId);
  if (!gate) {
    throw new Error('COMMERCIAL_GATE_COMPANY_NOT_FOUND');
  }
  return {
    blocked: gate.commercialBlocked,
    reason: gate.commercialBlockReason,
    sessionVersion: gate.companySessionVersion,
  };
}

async function markCommercialJourneyFirstLogin(userId: string, companyId: string): Promise<void> {
  try {
    await pool.queryTrustedBootstrap(
      `update public.master_commercial_onboardings
          set first_login_at = coalesce(first_login_at, now()),
              state = 'completed',
              first_access_status = 'accepted',
              first_access_last_error = null,
              temporary_password_used_at = coalesce(temporary_password_used_at, now()),
              completed_steps = case
                when completed_steps @> '["first_login"]'::jsonb then completed_steps
                else completed_steps || '["first_login"]'::jsonb
              end,
              last_error = null,
              updated_at = now()
        where operational_company_id = $2
          and (admin_user_id = $1 or admin_user_id is null)`,
      [userId, companyId],
    );
    await import('../master/operationalCompany/OperationalCompanyWriter.js')
      .then(({ markOperationalCompanyFirstAccessAccepted }) =>
        markOperationalCompanyFirstAccessAccepted(companyId),
      )
      .catch(() => undefined);
  } catch {
    // Compatibilidade: instalações que ainda não aplicaram a migration da jornada.
  }
}

export async function authenticateLogin(
  body: Record<string, unknown>,
): Promise<AuthLoginSuccess | AuthLoginFailure> {
  const identifier = normalizeIdentifier(body);
  const password = String(body?.password ?? '');
  logger.info({
    module: 'auth.login',
    action: 'STEP_VALIDATE_INPUT',
    message: 'Validação inicial do payload de login',
    meta: {
      identifier: identifier || null,
      hasPassword: Boolean(password),
    },
  });

  if (!identifier || !password) {
    logger.warn({
      module: 'auth.login',
      action: 'LOGIN_FAILED',
      message: 'Payload de login inválido',
      meta: { reason: 'missing_identifier_or_password' },
    });
    return { status: 400, error: 'Informe e-mail e senha.' };
  }

  logger.info({
    module: 'auth.login',
    action: 'AUTH_LOGIN_ATTEMPT',
    message: '[AUTH-FLOW] tentativa de login',
    meta: { identifier },
  });

  const secret = String(process.env.JWT_SECRET || '').trim();
  if (!secret) {
    return { status: 503, error: 'JWT_SECRET não configurado no servidor.' };
  }

  logger.info({
    module: 'auth.login',
    action: 'STEP_FIND_USER',
    message: 'Iniciando busca de usuário para login',
    meta: { identifier },
  });
  const user = await resolveLoginUser(identifier);
  if (!user) {
    logger.warn({
      module: 'auth.login',
      action: 'LOGIN_REJECT_REASON',
      message: 'Login rejeitado com 401',
      meta: {
        reason: 'USER_NOT_FOUND',
        location: 'authenticateLogin:if (!user)',
        lineHint: 'return { status: 401, error: AUTH_INVALID_CREDENTIALS }',
        identifier,
      },
    });
    logger.warn({
      module: 'auth.login',
      action: 'LOGIN_USER_DISCARDED',
      message: 'Usuário descartado na autenticação',
      meta: {
        condition: '!user',
        location: 'authenticateLogin:if (!user)',
        reason: 'resolveLoginUser_returned_null',
        identifier,
      },
    });
    logger.warn({
      module: 'auth.login',
      action: 'AUTH_LOGIN_USER_NOT_FOUND',
      message: '[AUTH-FLOW] usuário não encontrado',
      meta: { identifier },
    });
    logger.warn({
      module: 'auth.login',
      action: 'LOGIN_FAILED',
      message: 'Usuário não encontrado',
      meta: { reason: 'user_not_found', identifier },
    });
    return { status: 401, error: AUTH_INVALID_CREDENTIALS };
  }
  logger.info({
    module: 'auth.login',
    action: 'STEP_USER_FOUND',
    message: 'Usuário encontrado para login',
    userId: user.id,
    companyId: user.company_id,
    meta: {
      source: user.source,
      role: user.role,
      status: user.status,
    },
  });
  if (!user.company_id) {
    logger.warn({
      module: 'auth.login',
      action: 'LOGIN_REJECT_REASON',
      message: 'Login rejeitado com 401',
      meta: {
        reason: 'COMPANY_INVALID',
        location: 'authenticateLogin:if (!user.company_id)',
        userId: user.id,
      },
    });
    logger.warn({
      module: 'auth.login',
      action: 'LOGIN_USER_DISCARDED',
      message: 'Usuário descartado na autenticação',
      userId: user.id,
      meta: {
        condition: '!user.company_id',
        location: 'authenticateLogin:if (!user.company_id)',
        reason: 'missing_company_id',
      },
    });
    logger.warn({
      module: 'auth.login',
      action: 'LOGIN_FAILED',
      message: 'Usuário sem company_id',
      userId: user.id,
      meta: { reason: 'missing_company_id' },
    });
    return { status: 401, error: AUTH_INVALID_CREDENTIALS };
  }
  if (user.status && user.status !== 'active') {
    logger.warn({
      module: 'auth.login',
      action: 'LOGIN_REJECT_REASON',
      message: 'Login rejeitado com 401',
      meta: {
        reason: 'USER_INACTIVE',
        location: "authenticateLogin:if (user.status && user.status !== 'active')",
        userId: user.id,
        companyId: user.company_id,
        status: user.status,
      },
    });
    logger.warn({
      module: 'auth.login',
      action: 'LOGIN_USER_DISCARDED',
      message: 'Usuário descartado na autenticação',
      userId: user.id,
      companyId: user.company_id,
      meta: {
        condition: "user.status && user.status !== 'active'",
        location: "authenticateLogin:if (user.status && user.status !== 'active')",
        reason: 'inactive_user_status',
        status: user.status,
      },
    });
    logger.warn({
      module: 'auth.login',
      action: 'LOGIN_FAILED',
      message: 'Usuário inativo',
      userId: user.id,
      companyId: user.company_id,
      meta: { reason: 'inactive_user_status', status: user.status },
    });
    return { status: 401, error: AUTH_INVALID_CREDENTIALS };
  }

  // Gate comercial ANTES da senha: empresa bloqueada/expirada não deve mascarar como "Credenciais inválidas".
  let commercial: Awaited<ReturnType<typeof readCompanyCommercialGateForLogin>>;
  try {
    logger.info({
      module: 'auth.login',
      action: 'STEP_COMPANY_GATE',
      message: 'Validando gate comercial da empresa',
      userId: user.id,
      companyId: user.company_id,
    });
    commercial = await readCompanyCommercialGateForLogin(user.company_id);
    logger.info({
      module: 'auth.login',
      action: 'COMPANY_GATE_RESULT',
      message: 'Resultado do gate comercial',
      userId: user.id,
      companyId: user.company_id,
      meta: {
        blocked: commercial.blocked,
        reason: commercial.reason,
        companySessionVersion: commercial.sessionVersion,
      },
    });
  } catch (error) {
    const companyMissing =
      error instanceof Error && error.message === 'COMMERCIAL_GATE_COMPANY_NOT_FOUND';
    if (isCommercialGateUnavailableError(error) || companyMissing) {
      const originalMessage =
        error instanceof Error ? error.message : String(error);
      const originalCause =
        error instanceof Error && error.cause instanceof Error
          ? { message: error.cause.message, stack: error.cause.stack ?? null }
          : error instanceof Error && error.cause
            ? { message: String(error.cause), stack: null }
            : null;
      logger.error({
        module: 'auth.login',
        action: companyMissing
          ? 'AUTH_LOGIN_COMMERCIAL_COMPANY_MISSING'
          : 'AUTH_LOGIN_COMMERCIAL_GATE_UNAVAILABLE',
        message: companyMissing
          ? '[AUTH-FLOW] login recusado: empresa operacional inexistente no gate comercial'
          : '[AUTH-FLOW] login recusado: gate comercial indisponível',
        userId: user.id,
        companyId: user.company_id,
        meta: {
          originalMessage,
          originalName: error instanceof Error ? error.name : typeof error,
          originalCode: (error as { code?: unknown })?.code ?? null,
          originalCause,
          originalStack: error instanceof Error ? error.stack ?? null : null,
        },
        error,
      });
      if (companyMissing) {
        return {
          status: 503,
          error:
            'Empresa operacional não encontrada para esta conta. Verifique o vínculo company_id / companies.',
          code: 'COMMERCIAL_GATE_COMPANY_NOT_FOUND',
        };
      }
      return {
        status: 503,
        error: 'Não foi possível validar a situação comercial da empresa.',
        code: 'COMMERCIAL_GATE_UNAVAILABLE',
        ...(originalMessage
          ? { detail: originalMessage }
          : {}),
      };
    }
    throw error;
  }
  if (commercial.blocked) {
    logger.warn({
      module: 'auth.login',
      action: 'LOGIN_USER_DISCARDED',
      message: 'Usuário descartado na autenticação',
      userId: user.id,
      companyId: user.company_id,
      meta: {
        condition: 'commercial.blocked',
        location: 'authenticateLogin:if (commercial.blocked)',
        reason: commercial.reason ?? 'commercial_blocked',
      },
    });
    logger.warn({
      module: 'auth.login',
      action: 'AUTH_LOGIN_COMMERCIAL_BLOCKED',
      message: '[AUTH-FLOW] login bloqueado por estado comercial Master',
      userId: user.id,
      companyId: user.company_id,
      meta: { reason: commercial.reason },
    });
    logger.warn({
      module: 'auth.login',
      action: 'LOGIN_FAILED',
      message: 'Gate comercial bloqueou o login',
      userId: user.id,
      companyId: user.company_id,
      meta: { reason: commercial.reason ?? 'commercial_blocked' },
    });
    return {
      status: 403,
      error: commercialBlockLoginMessage(commercial.reason),
      code: 'COMMERCIAL_BLOCKED_BY_MASTER',
    };
  }

  if (!user.password_hash) {
    logger.warn({
      module: 'auth.login',
      action: 'LOGIN_REJECT_REASON',
      message: 'Login rejeitado com 401',
      meta: {
        reason: 'PASSWORD_INVALID',
        detail: 'empty_password_hash',
        location: 'authenticateLogin:if (!user.password_hash)',
        userId: user.id,
        companyId: user.company_id,
      },
    });
    logger.warn({
      module: 'auth.login',
      action: 'LOGIN_USER_DISCARDED',
      message: 'Usuário descartado na autenticação',
      userId: user.id,
      companyId: user.company_id,
      meta: {
        condition: '!user.password_hash',
        location: 'authenticateLogin:if (!user.password_hash)',
        reason: 'empty_password_hash',
      },
    });
    logger.warn({
      module: 'auth.login',
      action: 'PASSWORD_HASH_FOUND',
      message: 'Hash de senha ausente',
      userId: user.id,
      companyId: user.company_id,
      meta: { found: false, reason: 'empty_password_hash' },
    });
    return { status: 401, error: AUTH_INVALID_CREDENTIALS };
  }
  logger.info({
    module: 'auth.login',
    action: 'PASSWORD_HASH_FOUND',
    message: 'Hash de senha localizado',
    userId: user.id,
    companyId: user.company_id,
    meta: {
      found: true,
      hashLength: user.password_hash.length,
      library: 'bcryptjs',
    },
  });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    logger.warn({
      module: 'auth.login',
      action: 'LOGIN_REJECT_REASON',
      message: 'Login rejeitado com 401',
      meta: {
        reason: 'PASSWORD_INVALID',
        location: 'authenticateLogin:if (!valid)',
        userId: user.id,
        companyId: user.company_id,
        bcryptCompare: false,
      },
    });
    logger.warn({
      module: 'auth.login',
      action: 'LOGIN_USER_DISCARDED',
      message: 'Usuário descartado na autenticação',
      userId: user.id,
      companyId: user.company_id,
      meta: {
        condition: '!valid',
        location: 'authenticateLogin:if (!valid)',
        reason: 'password_compare_false',
      },
    });
    logger.warn({
      module: 'auth.login',
      action: 'AUTH_LOGIN_INVALID_PASSWORD',
      message: '[AUTH-FLOW] senha inválida',
      meta: { identifier, userId: user.id },
    });
    logger.warn({
      module: 'auth.login',
      action: 'LOGIN_FAILED',
      message: 'Senha inválida',
      userId: user.id,
      companyId: user.company_id,
      meta: { reason: 'password_compare_false' },
    });
    return { status: 401, error: AUTH_INVALID_CREDENTIALS };
  }

  // commercial já validado acima (não bloqueado) — segue criação de sessão.

  const signOptions: SignOptions = {
    expiresIn: (process.env.JWT_EXPIRES_IN?.trim() || '2h') as SignOptions['expiresIn'],
  };
  const normalizedRole = normalizeRole(user.role);
  const jti = newTokenJti();
  logger.info({
    module: 'auth.login',
    action: 'STEP_SESSION_CREATE',
    message: 'Criando sessão JWT',
    userId: user.id,
    companyId: user.company_id,
    meta: {
      role: normalizedRole,
      companySessionVersion: commercial.sessionVersion,
    },
  });
  const token = jwt.sign(
    {
      sub: user.id,
      userId: user.id,
      companyId: user.company_id,
      role: normalizedRole,
      jti,
      companySessionVersion: commercial.sessionVersion,
      mustChangePassword: Boolean(user.must_change_password),
    },
    secret,
    signOptions,
  );

  logger.info({
    module: 'auth.login',
    action: 'SESSION_CREATED',
    message: 'Sessão JWT criada',
    userId: user.id,
    companyId: user.company_id,
    meta: { identifier, jtiPresent: Boolean(jti) },
  });

  await markCommercialJourneyFirstLogin(user.id, user.company_id);

  logger.info({
    module: 'auth.login',
    action: 'STEP_LOGIN_SUCCESS',
    message: 'Login operacional concluído com sucesso',
    userId: user.id,
    companyId: user.company_id,
  });
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
      mustChangePassword: Boolean(user.must_change_password),
    },
  };
}
