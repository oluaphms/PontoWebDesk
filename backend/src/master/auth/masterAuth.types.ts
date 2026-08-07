/**
 * Auth do Painel Master — tipos.
 * Separado do login de empresas / JWT_SECRET do produto.
 */

export type MasterRole =
  | 'MASTER_OWNER'
  | 'MASTER_ADMIN'
  | 'MASTER_SUPPORT'
  | 'MASTER_FINANCE'
  | 'MASTER_AUDITOR';

export const MASTER_ROLES: readonly MasterRole[] = [
  'MASTER_OWNER',
  'MASTER_ADMIN',
  'MASTER_SUPPORT',
  'MASTER_FINANCE',
  'MASTER_AUDITOR',
] as const;

/** Usuário administrador da plataforma (não é user de empresa). */
export type MasterUser = {
  id: string;
  email: string;
  name: string;
  role: MasterRole;
  /** Hash scrypt — nunca senha em claro. */
  passwordHash: string;
  active: boolean;
  /**
   * Idealizador do SaaS (autor do sistema) — atributo imutável is_founder.
   * Proteção permanente (não usar e-mail/nome como regra).
   */
  isFounder: boolean;
  createdAt: string;
  updatedAt: string;
  meta?: Readonly<Record<string, unknown>>;
};

/**
 * Sessão Master emitida no login/refresh.
 * Isolada da sessão operacional (pwd_session / JWT_SECRET).
 */
export type MasterSession = {
  userId: string;
  email: string;
  name: string;
  role: MasterRole;
  /** JWT Master (MASTER_JWT_SECRET) — access token. */
  token: string;
  /** Refresh token opaco (rotação). */
  refreshToken: string;
  sessionId: string;
  jti: string;
  expiresAt: string;
  refreshExpiresAt: string;
  tokenType: 'master';
  permissions: readonly string[];
};

/** @deprecated Use MasterSession — mantido por compatibilidade. */
export type MasterAuthSession = MasterSession;

export type MasterAuthContext = {
  userId: string;
  email: string;
  name: string;
  role: MasterRole;
  jti?: string;
  sessionId?: string;
  issuedAt?: string;
  lastActivity?: string;
  device?: string | null;
  ip?: string | null;
  /** Bootstrap via MASTER_API_KEY (sem usuário). */
  viaApiKey?: boolean;
};

export type CreateMasterUserInput = {
  email: string;
  name: string;
  password: string;
  role: MasterRole;
  /** Somente bootstrap interno — APIs públicas não expõem criação de Founder. */
  isFounder?: boolean;
};

export type MasterLoginInput = {
  email: string;
  password: string;
  /** User-Agent / device fingerprint textual. */
  device?: string | null;
  /** IP do cliente. */
  ip?: string | null;
};

export type MasterRefreshInput = {
  /** Access JWT atual (compat). */
  token?: string;
  /** Refresh token opaco. */
  refreshToken?: string;
  device?: string | null;
  ip?: string | null;
};

export type MasterLogoutInput = {
  /** Access JWT e/ou refresh — revoga a sessão correspondente. */
  token?: string | null;
  refreshToken?: string | null;
  reason?: string;
};

/** Ações de auditoria de autenticação Master. */
export type MasterAuthAuditAction =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_INVALID_PASSWORD'
  | 'LOGIN_UNKNOWN_ACCOUNT'
  | 'LOGIN_BLOCKED_ACCOUNT'
  | 'LOGIN_REFRESH'
  | 'LOGIN_LOGOUT'
  | 'LOGIN_SESSION_EXPIRED'
  | 'LOGIN_MFA_REQUIRED'
  | 'LOGIN_MFA_FAILED'
  | 'MASTER_AUTH_INVALID_ATTEMPT'
  | 'MASTER_TOKEN_REVOKED'
  | 'MASTER_REFRESH_REUSE';
