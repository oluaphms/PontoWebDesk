/**
 * MasterAuthService — login/sessão/usuários do Painel Master (enterprise).
 * Não usa authLoginService / JWT_SECRET / cookies das empresas.
 */
import {
  createHash,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  randomBytes,
} from 'node:crypto';
import { conflict, invalid, MasterLoginError, notFound } from '../errors.js';
import {
  assertFounderMutationAllowed,
  bootstrapSlotIsFounder,
  configuredFounderUserIds,
} from './founderProtection.js';
import type { MasterUserStore } from './ports/MasterUserStore.js';
import type { MasterSessionStore } from './ports/MasterSessionStore.js';
import type { MasterSessionRecord } from './ports/MasterSessionStore.js';
import { InMemoryMasterUserStore } from './adapters/InMemoryMasterUserStore.js';
import { InMemoryMasterSessionStore } from './adapters/InMemoryMasterSessionStore.js';
import { InMemoryMasterLoginAttemptStore } from './adapters/InMemoryMasterLoginAttemptStore.js';
import type { MasterLoginAttemptStore } from './ports/MasterLoginAttemptStore.js';
import {
  decodeMasterJWT,
  newMasterJti,
  signMasterToken,
  verifyMasterToken,
} from './MasterJWT.js';
import { permissionsForRole } from './MasterPermission.js';
import {
  getMasterMaxSessions,
  getMasterRefreshTtlMs,
  getMasterAccessTtlMs,
} from './masterSessionConfig.js';
import type {
  CreateMasterUserInput,
  MasterAuthContext,
  MasterLoginInput,
  MasterLogoutInput,
  MasterRefreshInput,
  MasterRole,
  MasterSession,
  MasterUser,
} from './masterAuth.types.js';
import { MASTER_ROLES } from './masterAuth.types.js';

function nowIso(): string {
  return new Date().toISOString();
}

function hashPassword(password: string, salt?: string): string {
  const s = salt || randomBytes(16).toString('hex');
  const hash = scryptSync(password, s, 64).toString('hex');
  return `scrypt$${s}$${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hash] = parts;
  const check = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== check.length) return false;
  return timingSafeEqual(expected, check);
}

function publicUser(user: MasterUser): Omit<MasterUser, 'passwordHash'> {
  const { passwordHash: _, ...rest } = user;
  return rest;
}

function hashToken(raw: string): string {
  return createHash('sha256').update(String(raw)).digest('hex');
}

function newRefreshToken(): string {
  return `mrt_${randomBytes(32).toString('hex')}`;
}

function newSessionId(): string {
  return `msid_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

function toSession(
  user: Pick<MasterUser, 'id' | 'email' | 'name' | 'role'>,
  token: string,
  refreshToken: string,
  sessionId: string,
  jti: string,
  expiresAt: string,
  refreshExpiresAt: string,
): MasterSession {
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    token,
    refreshToken,
    sessionId,
    jti,
    expiresAt,
    refreshExpiresAt,
    tokenType: 'master',
    permissions: [...permissionsForRole(user.role)],
  };
}

export type MasterAuthServiceOptions = {
  users?: MasterUserStore;
  sessions?: MasterSessionStore;
  loginAttempts?: MasterLoginAttemptStore;
};

export class MasterAuthService {
  private readonly users: MasterUserStore;
  private readonly sessions: MasterSessionStore;
  private readonly loginAttempts: MasterLoginAttemptStore;
  private readonly resetChallenges = new Map<
    string,
    { userId: string; codeHash: string; expiresAt: number }
  >();

  constructor(opts: MasterAuthServiceOptions | MasterUserStore = {}) {
    // Compat: createInMemory / new MasterAuthService(userStore)
    if (opts && typeof (opts as MasterUserStore).findByEmail === 'function') {
      this.users = opts as MasterUserStore;
      this.sessions = new InMemoryMasterSessionStore();
      this.loginAttempts = new InMemoryMasterLoginAttemptStore();
    } else {
      const o = (opts || {}) as MasterAuthServiceOptions;
      this.users = o.users ?? new InMemoryMasterUserStore();
      this.sessions = o.sessions ?? new InMemoryMasterSessionStore();
      this.loginAttempts = o.loginAttempts ?? new InMemoryMasterLoginAttemptStore();
    }
  }

  static createInMemory(): MasterAuthService {
    return new MasterAuthService({
      users: new InMemoryMasterUserStore(),
      sessions: new InMemoryMasterSessionStore(),
      loginAttempts: new InMemoryMasterLoginAttemptStore(),
    });
  }

  /** Registra tentativa de login (best-effort — nunca lança). */
  private async recordLoginAttempt(input: {
    email: string;
    success: boolean;
    reason?: string | null;
    userId?: string | null;
    ip?: string | null;
    device?: string | null;
  }): Promise<void> {
    try {
      await this.loginAttempts.record({
        email: input.email,
        success: input.success,
        reason: input.reason ?? null,
        userId: input.userId ?? null,
        ip: input.ip ?? null,
        device: input.device ?? null,
      });
    } catch {
      // Persistência de auditoria não deve bloquear autenticação.
    }
  }

  getSessionStore(): MasterSessionStore {
    return this.sessions;
  }

  async createUser(input: CreateMasterUserInput): Promise<Omit<MasterUser, 'passwordHash'>> {
    const email = String(input.email || '').trim().toLowerCase();
    const name = String(input.name || '').trim();
    const password = String(input.password || '');
    if (!email || !name) throw invalid('email and name are required');
    if (password.length < 8) throw invalid('password must be at least 8 characters');
    if (!MASTER_ROLES.includes(input.role)) throw invalid(`invalid MasterRole: ${input.role}`);

    const existing = await this.users.findByEmail(email);
    if (existing) throw conflict(`master user already exists: ${email}`);

    const now = nowIso();
    const user: MasterUser = {
      id: `mu_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      email,
      name,
      role: input.role,
      passwordHash: hashPassword(password),
      active: true,
      isFounder: input.isFounder === true,
      createdAt: now,
      updatedAt: now,
    };
    await this.users.save(user);
    return publicUser(user);
  }

  async login(input: MasterLoginInput): Promise<MasterSession> {
    const email = String(input.email || '').trim().toLowerCase();
    const password = String(input.password || '');
    if (!email || !password) throw invalid('email and password are required');

    const user = await this.users.findByEmail(email);
    const passwordOk = !!(user && user.active && verifyPassword(password, user.passwordHash));
    if (!user || !user.active || !passwordOk) {
      const reason = !user
        ? 'unknown_account'
        : !user.active
          ? 'blocked_account'
          : 'invalid_password';
      await this.recordLoginAttempt({
        email,
        success: false,
        reason,
        userId: user?.id ?? null,
        ip: input.ip ?? null,
        device: input.device ?? null,
      });
      throw new MasterLoginError(reason);
    }

    await this.recordLoginAttempt({
      email,
      success: true,
      userId: user.id,
      ip: input.ip ?? null,
      device: input.device ?? null,
    });

    await this.enforceSessionLimit(user.id);

    const sessionId = newSessionId();
    const jti = newMasterJti();
    const issuedAt = nowIso();
    const refreshRaw = newRefreshToken();
    const refreshExpiresAt = new Date(Date.now() + getMasterRefreshTtlMs()).toISOString();

    const { token, expiresAt } = signMasterToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      sessionId,
      jti,
      issuedAt,
      lastActivity: issuedAt,
      device: input.device ?? null,
      ip: input.ip ?? null,
    });

    const record: MasterSessionRecord = {
      id: sessionId,
      userId: user.id,
      jti,
      refreshFamilyId: `mrf_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      refreshTokenHash: hashToken(refreshRaw),
      usedRefreshHashes: [],
      device: input.device ?? null,
      ip: input.ip ?? null,
      issuedAt,
      lastActivityAt: issuedAt,
      accessExpiresAt: expiresAt,
      refreshExpiresAt,
      revokedAt: null,
      revokeReason: null,
    };
    await this.sessions.save(record);

    return toSession(
      user,
      token,
      refreshRaw,
      sessionId,
      jti,
      expiresAt,
      refreshExpiresAt,
    );
  }

  /**
   * Renova a sessão Master com rotação de refresh token.
   * Aceita refresh token (preferencial) ou access JWT válido (compat).
   */
  async refresh(input: MasterRefreshInput | string): Promise<MasterSession> {
    const opts: MasterRefreshInput =
      typeof input === 'string' ? { token: input } : input || {};
    const accessToken = String(opts.token || '').trim();
    const refreshToken = String(opts.refreshToken || '').trim();

    if (!accessToken && !refreshToken) throw invalid('master_token_required');

    let record: MasterSessionRecord | null = null;
    let viaRefresh = false;

    if (refreshToken) {
      viaRefresh = true;
      const hash = hashToken(refreshToken);
      record = await this.sessions.findByRefreshHash(hash);
      if (!record) throw invalid('invalid_master_token');

      // Refresh já usado nesta família → possível replay → revoga sessão.
      if (record.usedRefreshHashes.includes(hash)) {
        await this.revokeSession(record.id, 'refresh_reuse');
        throw invalid('master_refresh_reuse');
      }
      if (record.refreshTokenHash !== hash) throw invalid('invalid_master_token');
    } else {
      const ctx = verifyMasterToken(accessToken);
      if (!ctx || ctx.viaApiKey || !ctx.sessionId || !ctx.jti) {
        throw invalid('invalid_master_token');
      }
      record = await this.sessions.findById(ctx.sessionId);
      if (!record || record.jti !== ctx.jti) throw invalid('invalid_master_token');
    }

    if (!record || record.revokedAt) throw invalid('master_token_revoked');
    if (Date.parse(record.refreshExpiresAt) <= Date.now()) {
      await this.revokeSession(record.id, 'refresh_expired');
      throw invalid('master_session_expired');
    }

    const user = await this.users.findById(record.userId);
    if (!user || !user.active) {
      await this.revokeSession(record.id, 'user_inactive');
      throw invalid('invalid_master_token');
    }

    const now = nowIso();
    const nextJti = newMasterJti();
    const nextRefresh = newRefreshToken();
    const previousRefreshHash = record.refreshTokenHash;

    const { token, expiresAt } = signMasterToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      sessionId: record.id,
      jti: nextJti,
      issuedAt: now,
      lastActivity: now,
      device: opts.device ?? record.device,
      ip: opts.ip ?? record.ip,
    });

    const used = [...record.usedRefreshHashes];
    if (viaRefresh) used.push(previousRefreshHash);
    // Limita histórico de hashes usados.
    while (used.length > 32) used.shift();

    const next: MasterSessionRecord = {
      ...record,
      jti: nextJti,
      refreshTokenHash: hashToken(nextRefresh),
      usedRefreshHashes: used,
      lastActivityAt: now,
      accessExpiresAt: expiresAt,
      device: opts.device ?? record.device,
      ip: opts.ip ?? record.ip,
    };
    await this.sessions.save(next);

    return toSession(
      user,
      token,
      nextRefresh,
      next.id,
      nextJti,
      expiresAt,
      next.refreshExpiresAt,
    );
  }

  /**
   * Logout verdadeiro — revoga sessão server-side (JWT + refresh).
   * Cookie é limpo na camada HTTP.
   */
  async logout(input: MasterLogoutInput = {}): Promise<{
    ok: true;
    tokenType: 'master';
    revoked: boolean;
    sessionId: string | null;
  }> {
    const access = String(input.token || '').trim();
    const refresh = String(input.refreshToken || '').trim();
    let record: MasterSessionRecord | null = null;

    if (access) {
      const decoded = decodeMasterJWT(access) || verifyMasterToken(access);
      if (decoded?.sessionId) {
        record = await this.sessions.findById(decoded.sessionId);
      } else if (decoded && 'jti' in decoded && decoded.jti) {
        record = await this.sessions.findByJti(String(decoded.jti));
      }
    }
    if (!record && refresh) {
      record = await this.sessions.findByRefreshHash(hashToken(refresh));
    }

    if (!record) {
      return { ok: true, tokenType: 'master', revoked: false, sessionId: null };
    }

    if (!record.revokedAt) {
      await this.revokeSession(record.id, input.reason || 'logout');
    }
    return {
      ok: true,
      tokenType: 'master',
      revoked: true,
      sessionId: record.id,
    };
  }

  /** Verifica se o access token está ativo (não revogado). */
  async assertActiveAccess(token: string): Promise<MasterAuthContext | null> {
    const ctx = verifyMasterToken(token);
    if (!ctx || ctx.viaApiKey || !ctx.sessionId || !ctx.jti) return ctx;

    let record = await this.sessions.findById(ctx.sessionId);
    if (!record) {
      // Store in-memory perde sessões no restart: JWT ainda válido → rehidrata (não é revogação).
      const user = await this.users.findById(ctx.userId);
      if (!user || !user.active) return null;
      const now = nowIso();
      const accessExpiresAt = new Date(Date.now() + getMasterAccessTtlMs()).toISOString();
      const refreshExpiresAt = new Date(Date.now() + getMasterRefreshTtlMs()).toISOString();
      record = {
        id: ctx.sessionId,
        userId: user.id,
        jti: ctx.jti,
        refreshFamilyId: `mrf_rehydrated_${ctx.sessionId.replace(/^msid_/, '').slice(0, 12)}`,
        refreshTokenHash: hashToken(`rehydrated_${ctx.jti}`),
        usedRefreshHashes: [],
        device: ctx.device ?? null,
        ip: ctx.ip ?? null,
        issuedAt: ctx.issuedAt || now,
        lastActivityAt: now,
        accessExpiresAt,
        refreshExpiresAt,
        revokedAt: null,
        revokeReason: null,
      };
      await this.sessions.save(record);
      return {
        ...ctx,
        lastActivity: now,
        device: record.device,
        ip: record.ip,
      };
    }
    if (record.revokedAt) return null;
    if (record.jti !== ctx.jti) return null;
    if (Date.parse(record.refreshExpiresAt) <= Date.now()) return null;

    // Touch last activity (best-effort).
    const now = nowIso();
    if (Date.parse(now) - Date.parse(record.lastActivityAt) > 30_000) {
      await this.sessions.save({ ...record, lastActivityAt: now });
    }
    return {
      ...ctx,
      lastActivity: record.lastActivityAt,
      device: record.device,
      ip: record.ip,
    };
  }

  /** Resolve contexto a partir do token (sem checar revogação — prefer assertActiveAccess). */
  resolveToken(token: string): MasterAuthContext | null {
    return verifyMasterToken(token);
  }

  async revokeSession(sessionId: string, reason: string): Promise<boolean> {
    const row = await this.sessions.findById(sessionId);
    if (!row) return false;
    if (row.revokedAt) return true;
    await this.sessions.save({
      ...row,
      revokedAt: nowIso(),
      revokeReason: reason,
      jti: `revoked_${row.jti}`,
      refreshTokenHash: `revoked_${row.refreshTokenHash}`,
    });
    return true;
  }

  private async enforceSessionLimit(userId: string): Promise<void> {
    const max = getMasterMaxSessions();
    const active = await this.sessions.listActiveByUser(userId);
    if (active.length < max) return;
    // Revoga as mais antigas até caber +1 (novo login).
    const sorted = [...active].sort(
      (a, b) => Date.parse(a.issuedAt) - Date.parse(b.issuedAt),
    );
    const toRevoke = sorted.slice(0, active.length - max + 1);
    for (const s of toRevoke) {
      await this.revokeSession(s.id, 'max_sessions');
    }
  }

  async getUser(id: string): Promise<Omit<MasterUser, 'passwordHash'>> {
    const user = await this.users.findById(id);
    if (!user) throw notFound('master_user', id);
    return publicUser(user);
  }

  async listUsers(): Promise<Array<Omit<MasterUser, 'passwordHash'>>> {
    return (await this.users.list()).map(publicUser);
  }

  async updateUser(
    id: string,
    input: { name?: string; role?: MasterRole; active?: boolean },
    actor?: { id?: string | null; isFounder?: boolean },
  ): Promise<Omit<MasterUser, 'passwordHash'>> {
    const current = await this.users.findById(id);
    if (!current) throw notFound('master_user', id);

    const name = input.name === undefined ? current.name : String(input.name).trim();
    const role = input.role ?? current.role;
    const active = input.active ?? current.active;
    if (!name) throw invalid('name is required');
    if (!MASTER_ROLES.includes(role)) throw invalid(`invalid MasterRole: ${role}`);

    assertFounderMutationAllowed(
      { id: actor?.id ?? null, isFounder: actor?.isFounder === true },
      {
        id: current.id,
        isFounder: current.isFounder === true,
        role: current.role,
        active: current.active,
      },
      {
        name: input.name !== undefined ? name : undefined,
        role: input.role,
        active: input.active,
      },
    );

    const removesActiveOwner =
      current.role === 'MASTER_OWNER' &&
      current.active &&
      (role !== 'MASTER_OWNER' || !active);
    if (removesActiveOwner) {
      const activeOwners = (await this.users.list()).filter(
        (user) => user.role === 'MASTER_OWNER' && user.active,
      );
      if (activeOwners.length <= 1) {
        throw conflict('cannot deactivate or demote the last active Master Owner');
      }
    }

    const updated = await this.users.save({
      ...current,
      name,
      role,
      active,
      isFounder: current.isFounder === true, // imutável no service
      updatedAt: nowIso(),
    });

    if (role !== current.role || active !== current.active) {
      await this.revokeAllUserSessions(id, active ? 'role_changed' : 'user_blocked');
    }
    return publicUser(updated);
  }

  async resetUserPassword(
    id: string,
    newPassword: string,
    actor?: { id?: string | null; isFounder?: boolean },
  ): Promise<Omit<MasterUser, 'passwordHash'>> {
    const password = String(newPassword || '');
    if (password.length < 8) throw invalid('password must be at least 8 characters');
    const current = await this.users.findById(id);
    if (!current) throw notFound('master_user', id);

    assertFounderMutationAllowed(
      { id: actor?.id ?? null, isFounder: actor?.isFounder === true },
      {
        id: current.id,
        isFounder: current.isFounder === true,
        role: current.role,
        active: current.active,
      },
      { resetPassword: true },
    );

    const updated = await this.users.save({
      ...current,
      passwordHash: hashPassword(password),
      isFounder: current.isFounder === true,
      updatedAt: nowIso(),
    });
    await this.revokeAllUserSessions(id, 'password_reset_by_master');
    return publicUser(updated);
  }

  /** Exclusão permanente — Founder é sempre negado. */
  async deleteUser(
    id: string,
    actor?: { id?: string | null; isFounder?: boolean },
  ): Promise<boolean> {
    const current = await this.users.findById(id);
    if (!current) throw notFound('master_user', id);
    assertFounderMutationAllowed(
      { id: actor?.id ?? null, isFounder: actor?.isFounder === true },
      {
        id: current.id,
        isFounder: current.isFounder === true,
        role: current.role,
        active: current.active,
      },
      { delete: true },
    );
    return this.users.delete(id);
  }

  private async revokeAllUserSessions(userId: string, reason: string): Promise<void> {
    const sessions = await this.sessions.listActiveByUser(userId);
    for (const session of sessions) {
      await this.revokeSession(session.id, reason);
    }
  }

  /**
   * Bootstrap idempotente de Owners configurados no ambiente.
   *
   * Slot 1 aceita MASTER_OWNER_* como fallback para compatibilidade.
   * Senhas só são usadas na criação; nunca são sobrescritas em reinícios.
   */
  async ensureBootstrapOwners(): Promise<Array<Omit<MasterUser, 'passwordHash'>>> {
    const slots = [
      {
        label: 'MASTER_OWNER_1',
        email: process.env.MASTER_OWNER_1_EMAIL || process.env.MASTER_OWNER_EMAIL,
        password: process.env.MASTER_OWNER_1_PASSWORD || process.env.MASTER_OWNER_PASSWORD,
        name:
          process.env.MASTER_OWNER_1_NAME ||
          process.env.MASTER_OWNER_NAME ||
          'Master Owner 1',
      },
      {
        label: 'MASTER_OWNER_2',
        email: process.env.MASTER_OWNER_2_EMAIL,
        password: process.env.MASTER_OWNER_2_PASSWORD,
        name: process.env.MASTER_OWNER_2_NAME || 'Master Owner 2',
      },
    ].map((slot) => ({
      ...slot,
      email: String(slot.email || '').trim().toLowerCase(),
      password: String(slot.password || ''),
      name: String(slot.name || '').trim(),
    }));

    for (const slot of slots) {
      if (Boolean(slot.email) !== Boolean(slot.password)) {
        throw invalid(`${slot.label}_EMAIL and ${slot.label}_PASSWORD must be set together`);
      }
    }

    const configured = slots.filter((slot) => slot.email && slot.password);
    if (new Set(configured.map((slot) => slot.email)).size !== configured.length) {
      throw invalid('Master Owners must use different emails');
    }
    if (
      configured.length > 1 &&
      new Set(configured.map((slot) => slot.password)).size !== configured.length
    ) {
      throw invalid('Master Owners must use different passwords');
    }

    const owners: Array<Omit<MasterUser, 'passwordHash'>> = [];
    for (const slot of configured) {
      const existing = await this.users.findByEmail(slot.email);
      if (existing) {
        // Bootstrap somente cria contas ausentes. Decisões administrativas
        // posteriores (bloqueio/rebaixamento) não são revertidas no restart.
        // Founder também não é reatribuído por e-mail — só por ID permanente.
        owners.push(publicUser(existing));
        continue;
      }
      owners.push(
        await this.createUser({
          email: slot.email,
          name: slot.name,
          password: slot.password,
          role: 'MASTER_OWNER',
          isFounder: bootstrapSlotIsFounder(slot.label),
        }),
      );
    }

    // Promoção one-way por ID permanente (MASTER_FOUNDER_USER_IDS) — nunca por e-mail.
    for (const founderId of configuredFounderUserIds()) {
      const row = await this.users.findById(founderId);
      if (!row || row.isFounder) continue;
      await this.users.save({
        ...row,
        isFounder: true,
        active: true,
        updatedAt: nowIso(),
      });
    }

    return owners;
  }

  async ensureBootstrapOwner(): Promise<Omit<MasterUser, 'passwordHash'> | null> {
    const owners = await this.ensureBootstrapOwners();
    return owners[0] ?? null;
  }

  /**
   * Solicita recuperação de senha Master (anti-enumeração).
   * Emite challengeId sempre; código real só se o e-mail existir.
   */
  async requestPasswordReset(emailRaw: string): Promise<{
    ok: true;
    challengeId: string;
    debugCode?: string;
  }> {
    const email = String(emailRaw || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw invalid('e-mail Master inválido');
    }
    await this.ensureBootstrapOwner();
    const challengeId = `mrc_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const user = await this.users.findByEmail(email);
    if (!user || !user.active) {
      this.resetChallenges.set(challengeId, {
        userId: '',
        codeHash: hashToken(`dummy_${challengeId}`),
        expiresAt: Date.now() + 15 * 60 * 1000,
      });
      return { ok: true, challengeId };
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    this.resetChallenges.set(challengeId, {
      userId: user.id,
      codeHash: hashToken(code),
      expiresAt: Date.now() + 15 * 60 * 1000,
    });
    // Sem SMTP Master: código fica nos logs do processo para o operador.
    console.info(`[master-auth] password reset code for ${email}: ${code} (challenge ${challengeId})`);
    const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    return {
      ok: true,
      challengeId,
      ...(isProd ? {} : { debugCode: code }),
    };
  }

  /** Confirma recuperação Master com código + nova senha. */
  async confirmPasswordReset(input: {
    challengeId: string;
    code: string;
    newPassword: string;
  }): Promise<{ ok: true }> {
    const challengeId = String(input.challengeId || '').trim();
    const code = String(input.code || '').trim();
    const newPassword = String(input.newPassword || '');
    if (!challengeId || !code) throw invalid('código de recuperação inválido');
    if (newPassword.length < 8) throw invalid('password must be at least 8 characters');

    const challenge = this.resetChallenges.get(challengeId);
    this.resetChallenges.delete(challengeId);
    if (!challenge || challenge.expiresAt < Date.now()) {
      throw invalid('código expirado ou inválido');
    }
    if (!challenge.userId || hashToken(code) !== challenge.codeHash) {
      throw invalid('código expirado ou inválido');
    }
    const user = await this.users.findById(challenge.userId);
    if (!user || !user.active) throw invalid('código expirado ou inválido');

    await this.users.save({
      ...user,
      passwordHash: hashPassword(newPassword),
      updatedAt: nowIso(),
    });

    const sessions = await this.sessions.listActiveByUser(user.id);
    for (const s of sessions) {
      await this.revokeSession(s.id, 'password_reset');
    }
    return { ok: true };
  }
}

export function roleAtLeast(role: MasterRole, allowed: MasterRole[]): boolean {
  return allowed.includes(role);
}
