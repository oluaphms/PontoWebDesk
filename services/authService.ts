import { observabilityConsole } from '../src/shared/logger/observabilityConsole';
/**
 * Authentication Service
 * 
 * Gerencia autenticação de usuários usando Supabase Auth
 */

import { getAppBaseUrl } from './appUrl';
import {
  auth,
  clearCurrentUserFromAllStorages,
  db,
  getSupabaseClient,
  getUserProfileStorage,
  isSupabaseConfigured,
  checkSupabaseConfigured,
  supabase,
} from './supabaseClient';
import { clearLocalAuthSession } from './supabase';
import { withTimeout } from '../src/utils/withTimeout';
import { getActiveLoginTrace, traceLoginStep } from '../src/auth/authPerformanceTrace';
import { measureSupabaseAsync } from '../src/auth/supabaseAuthLatency';
import { scheduleDeferredBootstrap } from '../src/auth/authBootstrapPriority';
import { normalizeAuthenticatedSession } from '../src/auth/authSessionNormalizer';
import { getCachedAuthProfile, setCachedAuthProfile, clearAuthProfileCache } from '../src/auth/authProfileCache';
import { runProfileHydrationSingleFlight, clearProfileHydrationInflight } from '../src/auth/profileHydrationSingleFlight';
import {
  setAuthDuplicateContext,
  clearAuthDuplicateContext,
  auditProfileRequestStart,
  auditProfileRequestEnd,
  auditSessionRequestStart,
  auditSessionRequestEnd,
} from '../src/auth/authDuplicateRequestAudit';
import { User } from '../types';
import {
  clearLocalSession,
  ensureDefaultLocalAdmin,
  getLocalSession,
  saveLocalSession,
  verifyLocalCredentials,
  type LocalSession,
} from '../src/services/localAuth';
import { isSupabaseBlocked } from '../src/utils/supabaseGuard';
import { enableDegradedMode } from '../src/services/systemMode';
import { fetchAuthMe } from '../src/services/authMe.service';
import { clearToken } from '../src/services/authToken';
import { cacheEmployees } from '../src/services/localDb';
import { getProvider } from '../src/services/getProvider';
import { apiPost, ApiError } from '../src/services/api';

function defaultUserPreferences(): User['preferences'] {
  return {
    notifications: true,
    theme: 'light',
    allowManualPunch: true,
    language: 'pt-BR',
  };
}

function parseUserPreferences(raw: unknown): User['preferences'] {
  const d = defaultUserPreferences();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return d;
  const o = raw as Record<string, unknown>;
  const theme =
    o.theme === 'dark' || o.theme === 'auto' || o.theme === 'light' ? o.theme : d.theme;
  const language =
    o.language === 'en-US' || o.language === 'pt-BR' ? o.language : d.language;
  return {
    notifications: typeof o.notifications === 'boolean' ? o.notifications : d.notifications,
    theme,
    allowManualPunch: typeof o.allowManualPunch === 'boolean' ? o.allowManualPunch : d.allowManualPunch,
    language,
  };
}

function rowStr(v: unknown): string {
  return v == null ? '' : String(v);
}

function parseDbUserRole(v: unknown, fallback: User['role']): User['role'] {
  const r = String(v ?? '').toLowerCase();
  if (r === 'admin' || r === 'hr' || r === 'supervisor' || r === 'employee') return r as User['role'];
  return fallback;
}
import { LogSeverity } from '../types';
import { logTenantLoginSuccess } from '../src/services/tenantAudit';
import { resolveTenantId } from '../src/services/tenantScope';
import { LoggingService } from './loggingService';
import { createMinimalSessionShell, dispatchProfileEnriched } from '../src/app/appShellBootstrap';
import { isLocalApiMode } from '../src/config/system';

export interface AuthResult {
  user: User | null;
  error: string | null;
  source?: 'api' | 'remote' | 'local' | 'offline-forced';
}

/** Evita chamadas repetidas a auth.updateUser (causavam lentidão, refresh em loop e logout falso). */
const TENANT_META_SYNC_KEY = 'sp_tenant_meta_sync';

/**
 * Timeout por tentativa em `getCurrentUser` (sessão + perfil). Após deploy / cold start do Supabase
 * (free tier) ou IndexedDB lento, 18s falhava sem motivo. Há **2ª tentativa** após pequeno atraso.
 * O `App.tsx` usa `INIT_HYDRATE_MS` menor que o pior caso (splash curto): o listener de auth +
 * fallback abaixo ainda recuperam sessão quando o SELECT do perfil estoura o tempo.
 */
const GET_CURRENT_USER_TIMEOUT_MS = 30_000;
const GET_CURRENT_USER_RETRY_DELAY_MS = 750;

function isSupabaseDown(error: unknown): boolean {
  const e = error as { message?: string; status?: number; code?: string };
  const msg = String(e?.message || '').toLowerCase();
  return (
    isSupabaseBlocked(error) ||
    e?.status === 402 ||
    msg.includes('exceed_egress_quota') ||
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('timeout')
  );
}

function persistCurrentUserToProfileStore(u: User): void {
  if (typeof window === 'undefined') return;
  try {
    getUserProfileStorage().setItem('current_user', JSON.stringify(u));
    window.dispatchEvent(new Event('current_user_changed'));
  } catch {
    // ignore
  }
}

function readCurrentUserFromProfileStore(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return getUserProfileStorage().getItem('current_user');
  } catch {
    return null;
  }
}

function mapUserToLocalSession(user: User): LocalSession {
  return {
    user_id: user.id,
    name: user.nome || user.email || 'Usuário',
    company_id: user.companyId || '',
    role: user.role || 'employee',
    last_login: Date.now(),
  };
}

function mapLocalSessionToUser(local: LocalSession): User {
  const roleRaw = String(local.role || 'employee').toLowerCase();
  const role: User['role'] =
    roleRaw === 'admin' || roleRaw === 'hr' || roleRaw === 'supervisor' || roleRaw === 'employee'
      ? (roleRaw as User['role'])
      : 'employee';
  return {
    id: local.user_id,
    nome: local.name || 'Usuário',
    email: '',
    cargo: 'Colaborador',
    role,
    createdAt: new Date(local.last_login || Date.now()),
    companyId: local.company_id || '',
    tenantId: local.company_id || '',
    departmentId: '',
    preferences: {
      notifications: true,
      theme: 'light',
      allowManualPunch: true,
      language: 'pt-BR',
    },
  };
}

function tryReadUserFromProfileStoreUnsafe(): User | null {
  try {
    const raw = readCurrentUserFromProfileStore();
    if (!raw) return null;
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

/** True se GoTrue já persistiu projeto (JWT) em local/session storage — falta distingue eco SIGNED_OUT de cold start vs logout real */
function hasSbAuthKeysInBrowser(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k?.startsWith('sb-')) return true;
    }
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k?.startsWith('sb-')) return true;
    }
    return false;
  } catch {
    return false;
  }
}

class AuthService {
  /** Login por senha em andamento: amplia retentativas de `getSession` no listener (evita callback(null) cedo). */
  private _passwordSignInActive = false;
  /** Previne que o listener onAuthStateChanged tente recuperar sessão durante o logout. */
  private _isSigningOut = false;
  /** Single-flight para chamadas concorrentes de getCurrentUser em Strict Mode. */
  private _getCurrentUserInflight: Promise<User | null> | null = null;
  /** Garante no máximo um refresh manual de sessão por vez (anti-loop). */
  private _isRefreshingSession = false;

  /**
   * BOOT vs LOGIN: enquanto o fluxo manual de login é dono do pipeline, o listener passivo ignora SIGNED_IN
   * (hidratação + navegação vêm só do submit).
   */
  private _manualLoginPipelineId: string | null = null;
  private _diagPipelineId: number | null = null;
  private _diagAttemptId: number | null = null;

  /**
   * Sincroniza tenant_id no user_metadata (JWT) — só chama API se ainda não estiver no token/cache.
   * Evita updateUser repetido (principal causa de lentidão/instabilidade no login).
   */
  private async syncTenantUserMetadata(
    appUser: User,
    authUser?: { user_metadata?: Record<string, unknown> } | null,
  ): Promise<void> {
    if (!isSupabaseConfigured()) return;
    const tid = resolveTenantId(appUser);
    if (!tid) return;
    const meta = authUser?.user_metadata as { tenant_id?: string; company_id?: string } | undefined;
    if (meta?.tenant_id === tid && (!meta.company_id || meta.company_id === tid)) {
      try {
        if (typeof window !== 'undefined') window.sessionStorage.setItem(TENANT_META_SYNC_KEY, tid);
      } catch {
        // ignora
      }
      return;
    }
    if (typeof window !== 'undefined') {
      try {
        const done = window.sessionStorage.getItem(TENANT_META_SYNC_KEY);
        if (done === tid) return;
      } catch {
        // ignora
      }
    }
    try {
      await supabase.auth.updateUser({
        data: { tenant_id: tid, company_id: tid },
      });
      if (typeof window !== 'undefined') {
        try {
          window.sessionStorage.setItem(TENANT_META_SYNC_KEY, tid);
        } catch {
          // ignora
        }
      }
    } catch {
      // não bloquear login
    }
  }

  /**
   * Após login: sync de tenant no JWT, refresh da sessão e só então auditoria.
   * Ordem evita INSERT em tenant_audit_log com RLS antes de get_my_company_id() alinhar ao perfil.
   */
  private enqueuePostLoginSideEffects(appUser: User, authUser: { user_metadata?: Record<string, unknown> } | null): void {
    const run = async () => {
      try {
        await this.syncTenantUserMetadata(appUser, authUser);
        await supabase.auth.refreshSession();
        await logTenantLoginSuccess(appUser);
      } catch {
        // auditoria não deve quebrar login
      }
    };
    if (typeof window === 'undefined') {
      void run();
      return;
    }
    scheduleDeferredBootstrap('post_login_tenant_audit', run);
  }

  /**
   * Resolve um identificador de login (email, CPF, nome completo, primeiro nome)
   * para um email válido que exista no Supabase Auth.
   *
   * Regras:
   * - Se contiver "@": tratado diretamente como email.
   * - Se for só dígitos com 11 caracteres: tratado como CPF (coluna `cpf` em public.users).
   * - Caso contrário: tenta nome completo em `users.nome` e depois primeiro nome (ILIKE).
   * - Se nada for encontrado, faz fallback para o comportamento antigo:
   *   `<identificador>@smartponto.com`.
   */
  private async resolveLoginEmail(identifier: string): Promise<string> {
    const raw = (identifier || '').trim();
    if (!raw) return raw;

    // Normaliza espaços para evitar falhas de match por múltiplos espaços/tabs.
    const rawNormalized = raw.replace(/\s+/g, ' ');
    const lower = rawNormalized.toLowerCase();

    // Atalhos antes de RPC/Supabase (modo API VPS não depende do GoTrue)
    if (lower === 'admin@smartponto.com') {
      return 'admin@pontowebdesk.com';
    }
    if (lower === 'admin' || lower === 'administrador') {
      return 'admin@pontowebdesk.com';
    }
    if (lower === 'desenvolvedor' || lower === 'dev') {
      return 'desenvolvedor@smartponto.com';
    }
    if (lower === 'funcionario' || lower === 'funcionário') {
      return 'funcionario@smartponto.com';
    }

    // Se for o usuário informando "nome"/"primeiro nome" (sem @),
    // o app ainda NÃO tem sessão auth; então RLS costuma bloquear leitura de public.users.
    // Para funcionar sempre, chamamos uma RPC SECURITY DEFINER que ignora RLS e resolve para o email.
    let attemptedRpc = false;
    if (!lower.includes('@') && isSupabaseConfigured()) {
      try {
        attemptedRpc = true;
        const result = await supabase.rpc('resolve_login_email', { p_identifier: rawNormalized });
        // supabase-js retorna { data, error }; mas algumas versões já retornam direto o data.
        const emailResolved =
          typeof result === 'object' && result !== null && 'data' in (result as any)
            ? (result as any).data
            : result;
        if (typeof emailResolved === 'string' && emailResolved.trim()) {
          return emailResolved.trim().toLowerCase();
        }
      } catch (rpcErr) {
        if (isSupabaseBlocked(rpcErr)) enableDegradedMode();
        // ignora e segue com fallback (db.select) para compatibilidade
      }
    }

    // 1) Já é um email
    if (lower.includes('@')) {
      return lower;
    }

    // Se Supabase não está configurado, mantém o comportamento antigo
    if (!isSupabaseConfigured()) {
      return `${lower}@smartponto.com`;
    }

    // 2) CPF (somente dígitos, 11 caracteres)
    const digitsOnly = rawNormalized.replace(/\D/g, '');
    if (digitsOnly.length === 11) {
      try {
        const byCpf = await db.select('users', [
          { column: 'cpf', operator: 'eq', value: digitsOnly },
        ], undefined, 1);
        if (byCpf?.[0]?.email) {
          return String(byCpf[0].email).trim().toLowerCase();
        }
      } catch {
        // ignora e segue para outras estratégias
      }
    }

    // 3) Nome completo exato
    try {
      const byFullName = await db.select('users', [
        // `eq` é case-sensitive; `ilike` torna a busca case-insensitive.
        { column: 'nome', operator: 'ilike', value: rawNormalized },
      ], undefined, 1);
      if (byFullName?.[0]?.email) {
        return String(byFullName[0].email).trim().toLowerCase();
      }
    } catch {
      // ignora e tenta primeiro nome
    }

    // 4) Primeiro nome com ILIKE (início do nome)
    const firstName = rawNormalized.split(/\s+/)[0];
    if (firstName) {
      try {
        const byFirstName = await db.select(
          'users',
          [{ column: 'nome', operator: 'ilike', value: `${firstName}%` }],
          undefined,
          5,
        );
        if (byFirstName?.length === 1 && byFirstName[0]?.email) {
          return String(byFirstName[0].email).trim().toLowerCase();
        }
        if (byFirstName?.length && byFirstName.length > 1) {
          throw new Error(
            `Existem múltiplos usuários com o primeiro nome "${firstName}". Use o e-mail completo ou o nome completo.`,
          );
        }
      } catch {
        // ignora; cai no fallback
      }

      // 4.1) Primeiro nome contido em qualquer posição
      // (ex.: "Morais Paulo" precisa casar com "%Paulo%")
      try {
        const byFirstNameContains = await db.select(
          'users',
          [{ column: 'nome', operator: 'ilike', value: `%${firstName}%` }],
          undefined,
          5,
        );
        if (byFirstNameContains?.length === 1 && byFirstNameContains[0]?.email) {
          return String(byFirstNameContains[0].email).trim().toLowerCase();
        }
        if (byFirstNameContains?.length && byFirstNameContains.length > 1) {
          throw new Error(
            `Existem múltiplos usuários com o primeiro nome "${firstName}". Use o e-mail completo ou o nome completo.`,
          );
        }
      } catch {
        // ignora; cai no fallback
      }
    }

    // 5) Fallback: padrão antigo `<identificador>@smartponto.com`
    // Evita gerar e-mail inválido quando o identificador tem múltiplas palavras
    // (ex.: "Paulo Henrique" vira "paulo henrique@smartponto.com") e a RPC não está disponível.
    if (attemptedRpc && rawNormalized.includes(' ')) return '';
    return `${lower}@smartponto.com`;
  }

  /**
   * Perfil mínimo quando existe sessão no Supabase Auth mas `public.users` falha
   * (RLS, timeout, rede lenta). Mantém o usuário logado no React em vez de voltar à tela de login.
   */
  private async buildMinimalAppUserFromAuthUser(supabaseUser: any): Promise<User> {
    const email = (supabaseUser?.email || '').trim().toLowerCase();
    let fallbackRole: User['role'] = 'employee';
    let fallbackCompanyId = '';
    if (email && supabaseUser?.id) {
      try {
        const roleRows = await Promise.race([
          db.select('users', [{ column: 'id', operator: 'eq', value: supabaseUser.id }], undefined as any, 1),
          new Promise<any[]>((r) => setTimeout(() => r([]), 4000)),
        ]);
        if (roleRows?.[0]) {
          const row = roleRows[0];
          if (row.role) {
            const r = String(row.role).toLowerCase();
            if (r === 'admin' || r === 'hr' || r === 'supervisor') fallbackRole = r as User['role'];
          }
          if (row.company_id) fallbackCompanyId = String(row.company_id);
        }
      } catch {
        // mantém defaults
      }
    }
    const metaRoleRaw =
      supabaseUser.app_metadata?.role ??
      supabaseUser.user_metadata?.role ??
      (Array.isArray(supabaseUser.app_metadata?.roles) ? supabaseUser.app_metadata.roles[0] : undefined);
    if (typeof metaRoleRaw === 'string') {
      const r = metaRoleRaw.toLowerCase();
      if (r === 'admin' || r === 'hr' || r === 'supervisor' || r === 'employee') {
        fallbackRole = r as User['role'];
      }
    }
    if (
      email === 'admin@pontowebdesk.com' ||
      email === 'admin@smartponto.com' ||
      email === 'desenvolvedor@smartponto.com'
    ) {
      fallbackRole = 'admin';
    }
    if (email === 'funcionario@smartponto.com') {
      fallbackRole = 'employee';
    }
    const u: User = {
      id: supabaseUser.id,
      nome: supabaseUser.user_metadata?.nome || (email ? email.split('@')[0] : 'Usuário'),
      email: supabaseUser.email || '',
      cargo: 'Colaborador',
      role: fallbackRole,
      createdAt: new Date(),
      companyId: fallbackCompanyId,
      tenantId: fallbackCompanyId,
      departmentId: '',
      avatar: supabaseUser.user_metadata?.avatar_url,
      preferences: { notifications: true, theme: 'light', allowManualPunch: true, language: 'pt-BR' },
    };
    return u;
  }

  /**
   * Perfil mínimo síncrono só a partir de Auth (sem I/O). Usado no shell paralelo do login.
   */
  private buildSyncMinimalAppUserFromAuthUser(supabaseUser: any): User {
    const email = (supabaseUser?.email || '').trim().toLowerCase();
    let fallbackRole: User['role'] = 'employee';
    const metaRoleRaw =
      supabaseUser.app_metadata?.role ??
      supabaseUser.user_metadata?.role ??
      (Array.isArray(supabaseUser.app_metadata?.roles) ? supabaseUser.app_metadata.roles[0] : undefined);
    if (typeof metaRoleRaw === 'string') {
      const r = metaRoleRaw.toLowerCase();
      if (r === 'admin' || r === 'hr' || r === 'supervisor' || r === 'employee') {
        fallbackRole = r as User['role'];
      }
    }
    if (
      email === 'admin@pontowebdesk.com' ||
      email === 'admin@smartponto.com' ||
      email === 'desenvolvedor@smartponto.com'
    ) {
      fallbackRole = 'admin';
    }
    if (email === 'funcionario@smartponto.com') {
      fallbackRole = 'employee';
    }
    const meta = supabaseUser.user_metadata as { tenant_id?: string; company_id?: string } | undefined;
    const cid = meta?.tenant_id || meta?.company_id || '';
    return {
      id: supabaseUser.id,
      nome: supabaseUser.user_metadata?.nome || (email ? email.split('@')[0] : 'Usuário'),
      email: supabaseUser.email || '',
      cargo: 'Colaborador',
      role: fallbackRole,
      createdAt: new Date(),
      companyId: cid,
      tenantId: cid,
      departmentId: '',
      avatar: supabaseUser.user_metadata?.avatar_url,
      preferences: { notifications: true, theme: 'light', allowManualPunch: true, language: 'pt-BR' },
    };
  }

  private extractTenantHintSync(authUser: any): string | null {
    const m = authUser?.user_metadata as { tenant_id?: string; company_id?: string } | undefined;
    const tid = m?.tenant_id || m?.company_id;
    return tid ? String(tid) : null;
  }

  private extractPermissionsHintSync(authUser: any): string {
    const r =
      authUser?.user_metadata?.role ??
      authUser?.app_metadata?.role ??
      (Array.isArray(authUser?.app_metadata?.roles) ? authUser.app_metadata.roles[0] : undefined);
    return typeof r === 'string' ? r : '';
  }

  /** Diagnóstico de trace (App.tsx). */
  setLoginDiagnostics(ctx: { pipelineId: number | null; attemptId: number | null }): void {
    this._diagPipelineId = ctx.pipelineId;
    this._diagAttemptId = ctx.attemptId;
    setAuthDuplicateContext(ctx);
  }

  clearLoginDiagnostics(): void {
    this._diagPipelineId = null;
    this._diagAttemptId = null;
    clearAuthDuplicateContext();
  }

  acquireManualLoginPipeline(): string {
    const id = `ml:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;
    this._manualLoginPipelineId = id;
    return id;
  }

  releaseManualLoginPipeline(token: string): void {
    if (this._manualLoginPipelineId === token) {
      this._manualLoginPipelineId = null;
    }
  }

  private isOnline(): boolean {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  }

  private maskEmailForLog(email: string): string {
    const e = String(email || '').trim();
    const at = e.indexOf('@');
    if (at < 1) return e ? '***' : '';
    return `${e.slice(0, Math.min(2, at))}***${e.slice(at)}`;
  }

  /** Erros de rede / cold start — podem ser repetidos; credenciais inválidas não. */
  private isRetriableLoginTransportError(error: unknown): boolean {
    const msg = String(
      (error as { message?: string })?.message ??
        (error as { error_description?: string })?.error_description ??
        '',
    ).toLowerCase();
    if (msg.includes('invalid login credentials')) return false;
    if (msg.includes('email not confirmed')) return false;
    return (
      msg.includes('fetch') ||
      msg.includes('failed to fetch') ||
      msg.includes('network') ||
      msg.includes('timeout') ||
      msg.includes('tempo esgotado') ||
      msg.includes('aborted') ||
      (error as { status?: number })?.status === 503 ||
      (error as { status?: number })?.status === 504
    );
  }

  /**
   * signInWithPassword com retry para cold start (free tier) e rede instável.
   * Não repete em credenciais inválidas.
   */
  private async signInWithPasswordWithColdStartRetry(
    email: string,
    password: string,
  ): Promise<{ user: any; session: any }> {
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (import.meta.env?.DEV && typeof console !== 'undefined') {
        const emailPreview = import.meta.env?.DEV ? email : this.maskEmailForLog(email);
        observabilityConsole.log('[LOGIN START]', { email: emailPreview, attempt: attempt + 1, maxAttempts });
      }
      try {
        const client = getSupabaseClient();
        if (!client) {
          throw new Error('Supabase não inicializado.');
        }
        const { data, error } = await measureSupabaseAsync(
          'signInWithPassword',
          () => client.auth.signInWithPassword({ email, password }),
          { attempt: attempt + 1, maxAttempts },
        );
        const sessionSummary = data?.session
          ? {
              expires_at: data.session.expires_at,
              tokenPreview: !!(data.session as { access_token?: string }).access_token,
            }
          : null;
        if (import.meta.env?.DEV && typeof console !== 'undefined') {
          observabilityConsole.log('[LOGIN RESULT]', {
            error: error?.message ?? error ?? null,
            data: data
              ? {
                  user: data.user ? { id: data.user.id, email: this.maskEmailForLog(data.user.email || '') } : null,
                  session: sessionSummary,
                }
              : null,
          });
        }
        if (!error && data?.user) {
          return { user: data.user, session: data.session };
        }
        if (!error && !data?.user) {
          if (attempt < maxAttempts - 1) {
            if (typeof console !== 'undefined') {
              observabilityConsole.warn('[LOGIN RETRY]', { afterMs: 2000, reason: 'resposta_sem_usuario' });
            }
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          throw new Error('Erro ao fazer login. Tente novamente.');
        }
        if (error) {
          if (isSupabaseBlocked(error)) {
            enableDegradedMode();
            throw error;
          }
          if (this.isRetriableLoginTransportError(error) && attempt < maxAttempts - 1) {
            if (typeof console !== 'undefined') {
              observabilityConsole.warn('[LOGIN RETRY]', { afterMs: 2000, attempt: attempt + 1 });
            }
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          if (this.isRetriableLoginTransportError(error)) {
            throw new Error(
              'Falha de conexão com o servidor. Verifique a internet ou tente novamente em instantes.',
            );
          }
          throw error;
        }
      } catch (err: unknown) {
        const msg = String((err as { message?: string })?.message ?? '').toLowerCase();
        if (msg.includes('invalid login credentials') || msg.includes('email not confirmed')) {
          throw err;
        }
        if (this.isRetriableLoginTransportError(err) && attempt < maxAttempts - 1) {
          if (typeof console !== 'undefined') {
            observabilityConsole.warn('[LOGIN RETRY]', { afterMs: 2000, reason: (err as Error)?.message });
          }
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        if (
          msg.includes('fetch') ||
          msg.includes('failed to fetch') ||
          msg.includes('timeout') ||
          msg.includes('network') ||
          msg.includes('tempo esgotado')
        ) {
          throw new Error(
            'Falha de conexão com o servidor. Verifique a internet ou tente novamente em instantes.',
          );
        }
        throw err;
      }
    }
    throw new Error('Falha de conexão com o servidor após várias tentativas.');
  }

  private isNetworkLikeError(error: unknown): boolean {
    const e = error as any;
    const text = String(
      e?.message || e?.details || e?.hint || e?.error?.message || e?.cause?.message || '',
    ).toLowerCase();
    return (
      text.includes('failed to fetch') ||
      text.includes('networkerror') ||
      text.includes('network request failed') ||
      text.includes('err_name_not_resolved') ||
      text.includes('name_not_resolved') ||
      text.includes('dns') ||
      text.includes('offline')
    );
  }

  private async safeRefreshSession(): Promise<boolean> {
    if (!isSupabaseConfigured() || !this.isOnline()) return false;
    if (this._isRefreshingSession) return false;
    this._isRefreshingSession = true;
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data?.session?.user) {
        if (import.meta.env?.DEV && typeof console !== 'undefined') {
          observabilityConsole.warn('[Auth] Refresh manual falhou:', error?.message || 'sem sessão');
        }
        return false;
      }
      return true;
    } catch (error) {
      if (import.meta.env?.DEV && typeof console !== 'undefined') {
        observabilityConsole.warn('[Auth] Refresh manual com erro:', error);
      }
      return false;
    } finally {
      this._isRefreshingSession = false;
    }
  }

  /**
   * Converte Supabase User para User do sistema (single-flight global por auth id).
   */
  private async supabaseUserToAppUser(supabaseUser: any): Promise<User | null> {
    const id = supabaseUser?.id as string | undefined;
    if (!id) {
      return this.supabaseUserToAppUserImpl(supabaseUser);
    }
    auditProfileRequestStart(id);
    try {
      return await runProfileHydrationSingleFlight(
        id,
        () => this.supabaseUserToAppUserImpl(supabaseUser),
        {
          reason: 'supabaseUserToAppUser',
          pipelineId: this._diagPipelineId,
          attemptId: this._diagAttemptId,
        },
      );
    } finally {
      auditProfileRequestEnd(id);
    }
  }

  private async supabaseUserToAppUserImpl(supabaseUser: any, attempt = 0): Promise<User | null> {
    try {
      const email = (supabaseUser.email || '').trim().toLowerCase();
      if (!email) return null;

      // 1) Buscar por id (auth.users.id = public.users.id)
      let userData = await db.select('users', [
        { column: 'id', operator: 'eq', value: supabaseUser.id }
      ]);

      // 2) Se não encontrou, buscar por email (caso public.users tenha id antigo diferente do auth)
      if (!userData?.length) {
        userData = await db.select('users', [
          { column: 'email', operator: 'eq', value: email }
        ], undefined, 1);
      }

      if (userData && userData.length > 0) {
        const user = userData[0] as Record<string, unknown>;
        const dbRole = rowStr(user.role).toLowerCase();
        let effectiveRole: User['role'] =
          dbRole === 'admin' || dbRole === 'hr' || dbRole === 'supervisor'
            ? parseDbUserRole(user.role, 'employee')
            : parseDbUserRole(user.role, 'employee');
        const emailLower = email.toLowerCase();
        if (
          emailLower === 'admin@pontowebdesk.com' ||
          emailLower === 'admin@smartponto.com' ||
          emailLower === 'desenvolvedor@smartponto.com'
        ) {
          effectiveRole = 'admin';
        }
        if (emailLower === 'funcionario@smartponto.com') {
          effectiveRole = 'employee';
        }
        const cid = rowStr(user.company_id);
        const tid = rowStr((user as { tenant_id?: unknown }).tenant_id) || cid;
        return {
          id: supabaseUser.id,
          nome:
            rowStr(user.nome) ||
            String(supabaseUser.user_metadata?.nome ?? '') ||
            email.split('@')[0] ||
            'Usuário',
          email: supabaseUser.email || '',
          cargo: rowStr(user.cargo) || 'Colaborador',
          role: effectiveRole,
          createdAt: user.created_at ? new Date(String(user.created_at)) : new Date(),
          companyId: cid,
          tenantId: tid,
          departmentId: rowStr(user.department_id),
          schedule_id: user.schedule_id != null ? rowStr(user.schedule_id) : undefined,
          shift_id:
            (user as { shift_id?: unknown }).shift_id != null
              ? rowStr((user as { shift_id?: unknown }).shift_id)
              : undefined,
          phone: user.phone != null ? rowStr(user.phone) : undefined,
          avatar:
            String(supabaseUser.user_metadata?.avatar_url ?? '') ||
            (user.avatar != null ? rowStr(user.avatar) : undefined),
          preferences: parseUserPreferences(user.preferences),
        };
      }

      // 3) Criar usuário básico se não existir no banco (primeiro login)
      //    Usa role vinda do metadata se existir (admin/dev), para não cair indevidamente como "employee".
      const metaRoleRaw =
        supabaseUser.app_metadata?.role ??
        supabaseUser.user_metadata?.role ??
        (Array.isArray(supabaseUser.app_metadata?.roles) ? supabaseUser.app_metadata.roles[0] : undefined);
      let resolvedRole: User['role'] = 'employee';
      if (typeof metaRoleRaw === 'string') {
        const r = metaRoleRaw.toLowerCase();
        if (r === 'admin' || r === 'hr' || r === 'supervisor' || r === 'employee') {
          resolvedRole = r as User['role'];
        }
      }
      const emailLower = email.toLowerCase();
      if (
        emailLower === 'admin@pontowebdesk.com' ||
        emailLower === 'admin@smartponto.com' ||
        emailLower === 'desenvolvedor@smartponto.com'
      ) {
        resolvedRole = 'admin';
      }
      if (emailLower === 'funcionario@smartponto.com') {
        resolvedRole = 'employee';
      }

      const newUser: User = {
        id: supabaseUser.id,
        nome: supabaseUser.user_metadata?.nome || email.split('@')[0] || 'Usuário',
        email: supabaseUser.email || '',
        cargo: 'Colaborador',
        role: resolvedRole,
        createdAt: new Date(),
        companyId: '',
        tenantId: '',
        departmentId: '',
        avatar: supabaseUser.user_metadata?.avatar_url,
        preferences: {
          notifications: true,
          theme: 'light',
          allowManualPunch: true,
          language: 'pt-BR'
        }
      };

      try {
        await db.insert('users', {
          id: newUser.id,
          nome: newUser.nome,
          email: newUser.email,
          cargo: newUser.cargo,
          role: newUser.role,
          company_id: newUser.companyId,
          department_id: newUser.departmentId,
          avatar: newUser.avatar,
          preferences: newUser.preferences,
          created_at: new Date().toISOString()
        });
      } catch (insertError: any) {
        // Conflito de email (já existe outro id): usar perfil por email na próxima busca
        if (insertError?.code === '23505' || insertError?.message?.includes('duplicate')) {
          const byEmail = await db.select('users', [
            { column: 'email', operator: 'eq', value: email }
          ], undefined, 1);
          if (byEmail?.[0]) {
            const u = byEmail[0] as Record<string, unknown>;
            const cid = rowStr(u.company_id);
            const tid = rowStr((u as { tenant_id?: unknown }).tenant_id) || cid;
            return {
              id: supabaseUser.id,
              nome: rowStr(u.nome) || newUser.nome,
              email: supabaseUser.email || '',
              cargo: rowStr(u.cargo) || 'Colaborador',
              role: parseDbUserRole(u.role, 'employee'),
              createdAt: u.created_at ? new Date(String(u.created_at)) : new Date(),
              companyId: cid,
              tenantId: tid,
              departmentId: rowStr(u.department_id),
              schedule_id: u.schedule_id != null ? rowStr(u.schedule_id) : undefined,
              shift_id:
                (u as { shift_id?: unknown }).shift_id != null
                  ? rowStr((u as { shift_id?: unknown }).shift_id)
                  : undefined,
              phone: u.phone != null ? rowStr(u.phone) : undefined,
              avatar: (u.avatar != null ? rowStr(u.avatar) : undefined) || newUser.avatar,
              preferences: parseUserPreferences(u.preferences),
            };
          }
        }
        throw insertError;
      }

      return newUser;
    } catch (error: any) {
      const msg = error?.message ?? error?.code ?? String(error);
      const isGoTrueLockContention =
        typeof msg === 'string' &&
        (/lock.*sb-/i.test(msg) ||
          /not released within/i.test(msg) ||
          /orphaned lock/i.test(msg) ||
          /forcefully acquiring/i.test(msg));
      const isTimeout =
        typeof msg === 'string' &&
        (msg.includes('Tempo esgotado') ||
          msg.includes('Tempo esgotado ao carregar dados') ||
          msg.includes('Supabase timeout') ||
          msg.includes('stole') ||
          msg.includes('Lock broken') ||
          /timeout/i.test(msg));
      const looksLikeSessionStorageRace =
        typeof msg === 'string' && (/lock/i.test(msg) || /indexeddb/i.test(msg) || /stole/i.test(msg));

      if ((isGoTrueLockContention || (isTimeout && looksLikeSessionStorageRace)) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 120 * (attempt + 1)));
        return this.supabaseUserToAppUserImpl(supabaseUser, attempt + 1);
      }

      if (isTimeout && attempt < 1) {
        await new Promise((r) => setTimeout(r, 280));
        return this.supabaseUserToAppUserImpl(supabaseUser, attempt + 1);
      }

      if (isTimeout) {
        if (looksLikeSessionStorageRace || isGoTrueLockContention) {
          if (import.meta.env?.DEV && typeof console !== 'undefined' && console.debug) {
            observabilityConsole.debug(
              '[Auth] Sessão/GoTrue em contenção ou timeout; usando dados mínimos do Auth até sincronizar.',
            );
          }
        } else if (import.meta.env?.DEV && typeof console !== 'undefined' && console.debug) {
          observabilityConsole.debug(
            '[Auth] Perfil em public.users demorou ou indisponível; usando dados mínimos do Auth até sincronizar.',
          );
        }
      } else {
        observabilityConsole.error('Erro ao converter usuário Supabase:', msg);
      }
      if (typeof msg === 'string' && (msg.includes('infinite recursion') || msg.includes('policy for relation'))) {
        observabilityConsole.warn('[Supabase RLS] Recursão nas políticas detectada. No Supabase (SQL Editor), execute a migration 20250329000000_fix_rls_users_recursion_definitive.sql. Veja INSTRUCOES_IMPORTACAO_FUNCIONARIOS.md §9.');
      }
      // Fallback: retorna usuário mínimo a partir só do Auth (tabela users inexistente/RLS/schema)
      const email = (supabaseUser?.email || '').trim().toLowerCase();
      if (!email) return null;
      // Tentar ainda assim preservar uma role elevada se vier no metadata (admin/hr/supervisor)
      const metaRoleRaw =
        supabaseUser?.app_metadata?.role ??
        supabaseUser?.user_metadata?.role ??
        (Array.isArray(supabaseUser?.app_metadata?.roles) ? supabaseUser.app_metadata.roles[0] : undefined);
      let resolvedRole: User['role'] = 'employee';
      if (typeof metaRoleRaw === 'string') {
        const r = metaRoleRaw.toLowerCase();
        if (r === 'admin' || r === 'hr' || r === 'supervisor' || r === 'employee') {
          resolvedRole = r as User['role'];
        }
      }
      const emailLower = email.toLowerCase();
      if (
        emailLower === 'admin@pontowebdesk.com' ||
        emailLower === 'admin@smartponto.com' ||
        emailLower === 'desenvolvedor@smartponto.com'
      ) {
        resolvedRole = 'admin';
      }
      if (emailLower === 'funcionario@smartponto.com') {
        resolvedRole = 'employee';
      }

      return {
        id: supabaseUser.id,
        nome: supabaseUser.user_metadata?.nome || email.split('@')[0] || 'Usuário',
        email: supabaseUser.email || '',
        cargo: 'Colaborador',
        role: resolvedRole,
        createdAt: new Date(),
        companyId: '',
        tenantId: '',
        departmentId: '',
        avatar: supabaseUser.user_metadata?.avatar_url,
        preferences: {
          notifications: true,
          theme: 'light',
          allowManualPunch: true,
          language: 'pt-BR'
        }
      };
    }
  }

  /**
   * Login com email e senha.
   * Encerra sessão local antes do signIn para troca de usuário confiável (scope local evita corrida com signOut global).
   */
  async signInWithEmail(identifier: string, password: string): Promise<AuthResult> {
    let resolvedEmail = '';
    const isEmailInput = (identifier || '').trim().includes('@');
    const preLoginCachedUser = tryReadUserFromProfileStoreUnsafe();
    if (isLocalApiMode()) {
      try {
        const resolvedForApi = await this.resolveLoginEmail(identifier);
        const loginIdentifier = resolvedForApi || identifier.trim().toLowerCase();
        const apiRes = await getProvider().login({ identifier: loginIdentifier, password });
        const apiUser = apiRes?.user as
          | {
              id?: string;
              nome?: string;
              email?: string;
              company_id?: string;
              role?: string;
              cargo?: string | null;
              department_id?: string | null;
              schedule_id?: string | null;
              shift_id?: string | null;
              phone?: string | null;
              avatar?: string | null;
              preferences?: User['preferences'];
            }
          | undefined;
        if (apiRes?.ok && apiUser?.id) {
          const mapped = mapLocalSessionToUser({
            user_id: String(apiUser.id),
            name: String(apiUser.nome || apiUser.email || identifier),
            company_id: String(apiUser.company_id || ''),
            role: String(apiUser.role || 'employee'),
            last_login: Date.now(),
          });
          mapped.email = String(apiUser.email || identifier);
          mapped.nome = String(apiUser.nome || mapped.nome || apiUser.email || identifier);
          mapped.cargo = String(apiUser.cargo || mapped.cargo || 'Colaborador');
          mapped.departmentId = apiUser.department_id != null ? String(apiUser.department_id) : '';
          mapped.schedule_id = apiUser.schedule_id != null ? String(apiUser.schedule_id) : undefined;
          mapped.shift_id = apiUser.shift_id != null ? String(apiUser.shift_id) : undefined;
          mapped.phone = apiUser.phone != null ? String(apiUser.phone) : undefined;
          mapped.avatar = apiUser.avatar != null ? String(apiUser.avatar) : mapped.avatar;
          mapped.preferences = parseUserPreferences(apiUser.preferences);
          await saveLocalSession(mapUserToLocalSession(mapped));
          persistCurrentUserToProfileStore(mapped);
          try {
            const employees = await getProvider().getEmployees(mapped.companyId);
            if (employees.length > 0) await cacheEmployees(employees);
          } catch {
            await cacheEmployees([
              {
                id: mapped.id,
                nome: mapped.nome,
                company_id: mapped.companyId,
                role: mapped.role,
                status: 'active',
              },
            ]);
          }
          return { user: mapped, error: null, source: 'api' };
        }
      } catch (apiErr) {
        const msg = apiErr instanceof Error ? apiErr.message : 'Falha no login';
        return { user: null, error: msg || 'Credenciais inválidas' };
      }
      return { user: null, error: 'Credenciais inválidas' };
    }
    try {
      // Resolver identificador (email, CPF, nome) para um email válido
      resolvedEmail = await this.resolveLoginEmail(identifier);

      if (!resolvedEmail) {
        return {
          user: null,
          error:
            'Não foi possível resolver o nome para um e-mail válido. Use o e-mail completo (ou o nome completo) no campo de login.',
        };
      }

      this._passwordSignInActive = true;

      try {
        clearCurrentUserFromAllStorages();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('current_user_changed'));
        }
      } catch {
        // ignora
      }
      try {
        await auth.signOut({ scope: 'local' });
      } catch {
        // segue: já sem sessão ou storage limpo
      }
      await clearLocalAuthSession();

      const signPayload = await this.signInWithPasswordWithColdStartRetry(resolvedEmail, password);

      const norm = normalizeAuthenticatedSession({
        session: signPayload.session,
        user: signPayload.user,
      });
      if (norm.ok === false) {
        return {
          user: null,
          error: norm.reason === 'missing_user' ? 'Erro ao fazer login. Tente novamente.' : 'Sessão inválida após login.',
        };
      }
      const authUser = norm.authUser;

      traceLoginStep(getActiveLoginTrace(), 'user_fetch_start');
      const tenantHint = this.extractTenantHintSync(authUser);
      const { appUser } = createMinimalSessionShell(authUser, signPayload.session);
      traceLoginStep(getActiveLoginTrace(), 'user_fetch_success');

      persistCurrentUserToProfileStore(appUser);
      setCachedAuthProfile(
        appUser.id,
        resolveTenantId(appUser) || appUser.companyId || tenantHint || '_',
        appUser,
      );

      if (appUser.companyId) {
        void LoggingService.log({
          severity: LogSeverity.INFO,
          action: 'LOGIN_SUCCESS',
          userId: appUser.id,
          userName: appUser.nome,
          companyId: appUser.companyId,
          details: {
            role: appUser.role,
            email: appUser.email,
            mode: 'minimal_shell_immediate',
          },
        });
      }

      scheduleDeferredBootstrap('login_full_profile', async () => {
        try {
          const full = await measureSupabaseAsync('login_profile_deferred', () => this.supabaseUserToAppUser(authUser), {
            source: 'signInWithEmail_deferred',
          }).catch(() => null as User | null);
          if (full && full.id === appUser.id) {
            persistCurrentUserToProfileStore(full);
            setCachedAuthProfile(full.id, resolveTenantId(full) || full.companyId || tenantHint || '_', full);
            dispatchProfileEnriched(full);
          }
        } catch {
          // perfil completo é opcional; shell já navegou
        }
      });

      this.enqueuePostLoginSideEffects(appUser, authUser as { user_metadata?: Record<string, unknown> });
      await saveLocalSession(mapUserToLocalSession(appUser));
      return { user: appUser, error: null, source: 'remote' };
    } catch (error: any) {
      if (isSupabaseDown(error)) {
        const local = await getLocalSession();
        if (local) {
          const localUser = mapLocalSessionToUser(local);
          persistCurrentUserToProfileStore(localUser);
          return { user: localUser, error: null, source: 'local' };
        }
        if (preLoginCachedUser?.id) {
          const fallbackLocal = preLoginCachedUser;
          await saveLocalSession(mapUserToLocalSession(fallbackLocal));
          persistCurrentUserToProfileStore(fallbackLocal);
          return { user: fallbackLocal, error: null, source: 'local' };
        }
        if (isSupabaseBlocked(error)) {
          enableDegradedMode();
          observabilityConsole.warn('[MODO LOCAL] auth');
          await ensureDefaultLocalAdmin();
          const credUser = await verifyLocalCredentials(identifier, password);
          if (credUser) {
            const mapped = mapLocalSessionToUser({
              user_id: credUser.id,
              name: credUser.name,
              company_id: credUser.company_id,
              role: credUser.role,
              last_login: Date.now(),
            });
            await saveLocalSession(mapUserToLocalSession(mapped));
            persistCurrentUserToProfileStore(mapped);
            await cacheEmployees([
              {
                id: mapped.id,
                nome: mapped.nome,
                company_id: mapped.companyId,
                role: mapped.role,
                status: 'active',
              },
            ]);
            return { user: mapped, error: null, source: 'local' };
          }
          const forcedLocalSession: LocalSession = {
            user_id: 'offline-user',
            name: 'Usuário Offline',
            company_id: 'offline-company',
            role: 'admin',
            last_login: Date.now(),
          };
          await saveLocalSession(forcedLocalSession);
          const forcedUser = mapLocalSessionToUser(forcedLocalSession);
          persistCurrentUserToProfileStore(forcedUser);
          await cacheEmployees([
            {
              id: forcedUser.id,
              nome: forcedUser.nome,
              company_id: forcedUser.companyId,
              role: forcedUser.role,
              status: 'active',
            },
          ]);
          return { user: forcedUser, error: null, source: 'offline-forced' };
        }
        return { user: null, error: 'Sem conexão e sem sessão local' };
      }
      let errorMessage = 'Erro ao fazer login';
      const msg = error?.message ?? '';
      const msgLower = msg.toLowerCase();

      if (
        msgLower.includes('fetch') ||
        msgLower.includes('failed to fetch') ||
        msgLower.includes('network') ||
        msgLower.includes('timeout') ||
        msgLower.includes('tempo esgotado')
      ) {
        errorMessage =
          'Falha de conexão com o servidor. Verifique a internet ou tente novamente em instantes.';
      } else if (msg.includes('Invalid login credentials') || error?.status === 400) {
        if (!isEmailInput && resolvedEmail) {
          errorMessage = `Usuário ou senha incorreto. O nome "${identifier}" foi resolvido para: ${resolvedEmail}. Se não for o e-mail correto, use o e-mail completo ou o nome completo.`;
        } else {
          errorMessage =
            'Usuário ou senha incorreto. Se você foi importado ou cadastrado e nunca logou, peça ao administrador ativar seu acesso.';
        }
      } else if (msg.includes('Email not confirmed')) {
        errorMessage = 'E-mail ainda não confirmado. No Supabase: Authentication → Users → clique no usuário → "Confirm email". Ou peça ao administrador confirmar; novos cadastros pelo painel já são confirmados automaticamente.';
      } else if (msg.includes('Informe e-mail e senha')) {
        errorMessage = msg;
      } else if (msg) {
        errorMessage = msg;
      }

      return { user: null, error: errorMessage, source: 'remote' };
    } finally {
      setTimeout(() => {
        this._passwordSignInActive = false;
      }, 12_000);
    }
  }

  /**
   * Registro de novo usuário
   */
  async signUpWithEmail(
    email: string,
    password: string,
    nome: string,
    companyId: string
  ): Promise<AuthResult> {
    try {
      const data = await auth.signUp(email, password, {
        nome,
        company_id: companyId
      });

      if (!data || !data.user) {
        return { user: null, error: 'Erro ao criar conta. Tente novamente.' };
      }

      if (data.user) {
        // Criar usuário no banco de dados
        const newUser: User = {
          id: data.user.id,
          nome,
          email,
          cargo: 'Colaborador',
          role: 'employee',
          createdAt: new Date(),
          companyId,
          tenantId: companyId,
          departmentId: '',
          avatar: data.user.user_metadata?.avatar_url,
          preferences: {
            notifications: true,
            theme: 'light',
            allowManualPunch: true,
            language: 'pt-BR'
          }
        };

        await db.insert('users', {
          id: newUser.id,
          nome: newUser.nome,
          email: newUser.email,
          cargo: newUser.cargo,
          role: newUser.role,
          company_id: newUser.companyId,
          department_id: newUser.departmentId,
          avatar: newUser.avatar,
          preferences: newUser.preferences,
          created_at: new Date().toISOString()
        });

        persistCurrentUserToProfileStore(newUser);
        return { user: newUser, error: null };
      }

      return { user: null, error: 'Erro ao criar conta' };
    } catch (error: any) {
      let errorMessage = 'Erro ao criar conta';

      if (error.message) {
        if (error.message.includes('User already registered')) {
          errorMessage = 'Este email já está em uso';
        } else if (error.message.includes('Password')) {
          errorMessage = 'Senha muito fraca';
        } else {
          errorMessage = error.message;
        }
      }

      return { user: null, error: errorMessage };
    }
  }

  /**
   * Login com Google
   */
  async signInWithGoogle(): Promise<AuthResult> {
    try {
      const result = await auth.signInWithOAuth('google');

      // OAuth redireciona, então retornamos sucesso
      // O callback será tratado no componente
      return { user: null, error: null };
    } catch (error: any) {
      return {
        user: null,
        error: error.message || 'Erro ao fazer login com Google'
      };
    }
  }

  /**
   * Logout: limpa sessão no Supabase e todo rastro local (evita loop ao logar novamente).
   */
  async signOut(): Promise<void> {
    const startedAt = Date.now();
    try {
      const { apiPost } = await import('../src/services/api');
      await apiPost('/auth/logout', {});
    } catch {
      // revogação no servidor é best-effort
    }
    clearToken();
    try {
      const current = await this.getCurrentUser().catch(() => null);
      if (current?.companyId) {
        void LoggingService.log({
          severity: LogSeverity.INFO,
          action: 'LOGOUT',
          userId: current.id,
          userName: current.nome,
          companyId: current.companyId,
          entity: 'users',
          entityId: current.id,
          details: {},
        });
      }
    } catch {
      // auditoria de logout não deve bloquear encerramento de sessão
    }
    // Sinaliza para o listener onAuthStateChanged ignorar eventos de sessão nula durante o logout.
    this._isSigningOut = true;
    this._manualLoginPipelineId = null;
    clearAuthProfileCache();
    clearProfileHydrationInflight();
    this.clearLoginDiagnostics();
    try {
      // 1) Derruba a sessão local imediatamente (instantâneo).
      // Isso evita ficar preso num estado “meio logado” no PWA.
      await clearLocalAuthSession();
      await clearLocalSession();

      // 2) Tenta invalidar sessão no servidor também (quando houver rede).
      // `global` faz logout mais robusto em cenários com múltiplos dispositivos/sessões.
      await auth.signOut({ scope: 'global' });
    } catch (error) {
      if (import.meta.env?.DEV && typeof console !== 'undefined') {
        observabilityConsole.warn('[Auth] signOut falhou (seguindo com limpeza local):', error);
      } else {
        observabilityConsole.error('Erro ao fazer logout:', error);
      }
    } finally {
      try {
        if (typeof window !== 'undefined') {
          clearCurrentUserFromAllStorages();
          window.dispatchEvent(new Event('current_user_changed'));

          try {
            window.sessionStorage.removeItem(TENANT_META_SYNC_KEY);
          } catch {
            // ignora
          }

          // Tokens/artefatos do Supabase
          const clearSbKeys = (storage: Storage | undefined) => {
            if (!storage) return;
            const keys: string[] = [];
            for (let i = 0; i < storage.length; i++) {
              const k = storage.key(i);
              if (k && k.startsWith('sb-')) keys.push(k);
            }
            keys.forEach((k) => storage.removeItem(k));
          };
          clearSbKeys(window.sessionStorage);
          clearSbKeys(window.localStorage);

          // Cookies legados (se algum middleware definiu sb-* ou similar)
          try {
            document.cookie.split(';').forEach((c) => {
              const name = c.split('=')[0]?.trim();
              if (name && (name.startsWith('sb-') || name.toLowerCase().includes('supabase'))) {
                document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;SameSite=Lax`;
              }
            });
          } catch {
            // ignora
          }
        }
      } catch {
        // ignora falha ao limpar storage
      } finally {
        // Libera a flag após um tick para garantir que eventos pendentes do Supabase já foram processados.
        setTimeout(() => { this._isSigningOut = false; }, 500);
        if (import.meta.env?.DEV && typeof console !== 'undefined') {
          observabilityConsole.info('[Auth] Logout concluído em', Date.now() - startedAt, 'ms');
        }
      }
    }
  }

  /**
   * Alterar senha do usuário atual
   */
  async updatePassword(newPassword: string): Promise<void> {
    try {
      if (isLocalApiMode()) {
        await getProvider().updatePassword(newPassword);
        return;
      }
      await auth.updatePassword(newPassword);
    } catch (error: any) {
      throw new Error(error.message || 'Erro ao alterar senha');
    }
  }

  /**
   * Recuperação de senha – envia link por e-mail (Supabase Auth).
   * redirectTo usa VITE_APP_URL ou origin + '/reset-password'.
   */
  async resetPassword(email: string): Promise<{ success: boolean; error: string | null }> {
    const normalizedEmail = email.trim().toLowerCase();
    try {
      await apiPost('/auth/reset-password', { email: normalizedEmail });
      return { success: true, error: null };
    } catch (apiError: unknown) {
      if (!(apiError instanceof ApiError && apiError.status === 404)) {
        const message = apiError instanceof Error ? apiError.message : 'Erro ao enviar email de recuperação';
        return { success: false, error: message };
      }
    }

    if (isLocalApiMode()) {
      return {
        success: false,
        error: 'Recuperação de senha por e-mail ainda não está disponível no modo API local. Solicite a redefinição ao administrador.',
      };
    }

    try {
      const redirectTo = `${this.getResetRedirectUrl()}/reset-password`;
      await auth.resetPassword(normalizedEmail, redirectTo);
      return { success: true, error: null };
    } catch (error: any) {
      let errorMessage = 'Erro ao enviar email de recuperação';
      if (error?.message) {
        if (error.message.includes('not found')) errorMessage = 'Usuário não encontrado';
        else if (/redirect|url.*config|smtp/i.test(error.message))
          errorMessage = `Falha ao enviar. No Supabase: Authentication → URL Configuration, adicione: ${this.getResetRedirectUrl()}`;
        else errorMessage = error.message;
      }
      return { success: false, error: errorMessage };
    }
  }

  /** URL base para redirect de recuperação (VITE_APP_URL ou origin). */
  private getResetRedirectUrl(): string {
    return getAppBaseUrl();
  }

  /**
   * Resolve identificador (e-mail ou nome) para e-mail na tabela users.
   * Usado na recuperação de senha quando o usuário não informa e-mail.
   */
  async getEmailForReset(identifier: string): Promise<string | null> {
    if (!isSupabaseConfigured()) return null;
    const q = identifier.trim().toLowerCase();
    if (!q) return null;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (emailRegex.test(q)) return q;
    try {
      const rows = await db.select('users', [{ column: 'email', operator: 'eq', value: q }], undefined as any, 1);
      if (rows?.[0]?.email) return String(rows[0].email).trim().toLowerCase();
      const byName = await db.select('users', [{ column: 'nome', operator: 'ilike', value: `%${q}%` }], undefined as any, 1);
      return byName?.[0]?.email ? String(byName[0].email).trim().toLowerCase() : null;
    } catch {
      return null;
    }
  }

  /**
   * Obtém ou restaura a sessão de recuperação a partir do hash da URL (type=recovery).
   * Usar antes de updateUser({ password }) no fluxo de redefinir senha.
   */
  async getOrRestoreRecoverySession(): Promise<{ session: any }> {
    if (!isSupabaseConfigured()) return { session: null };
    try {
      if (typeof supabase.auth.initialize === 'function') await supabase.auth.initialize();
      const { data: sessionData } = await auth.getSession();
      const session = sessionData?.session ?? null;
      if (session?.user?.id) return { session };
      if (typeof window === 'undefined' || !window.location?.hash) return { session: null };
      const hash = window.location.hash.replace(/^#/, '');
      const params = new URLSearchParams(hash);
      if (params.get('type') !== 'recovery') return { session: null };
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (error) return { session: null };
        const { data: nextData } = await auth.getSession();
        return { session: nextData?.session ?? null };
      }
      const tokenHash = params.get('token_hash');
      if (tokenHash) {
        const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
        if (error) return { session: null };
        return { session: data?.session ?? null };
      }
      return { session: null };
    } catch {
      return { session: null };
    }
  }

  /** Remove o hash de recuperação da URL após redefinir a senha (segurança). */
  clearRecoveryHashFromUrl(): void {
    try {
      if (typeof window !== 'undefined' && window.history?.replaceState && window.location?.hash) {
        const hash = window.location.hash.replace(/^#/, '');
        const params = new URLSearchParams(hash);
        if (params.get('type') === 'recovery') {
          window.history.replaceState({}, '', window.location.pathname + window.location.search || '/');
        }
      }
    } catch {
      // ignore
    }
  }

  /**
   * Obter usuário atual (com timeout para evitar loading infinito em rede lenta / RLS pesado).
   */
  async getCurrentUser(): Promise<User | null> {
    if (this._getCurrentUserInflight) return this._getCurrentUserInflight;
    const p = (async () => {
      try {
        let error: unknown;
        try {
          return await withTimeout(this.getCurrentUserResolved(), GET_CURRENT_USER_TIMEOUT_MS, 'carregar sessão');
        } catch (e1) {
          error = e1;
          const msg1 = String((e1 as { message?: string })?.message || '');
          if (msg1.includes('Tempo esgotado')) {
            await new Promise((r) => setTimeout(r, GET_CURRENT_USER_RETRY_DELAY_MS));
            try {
              return await withTimeout(
                this.getCurrentUserResolved(),
                GET_CURRENT_USER_TIMEOUT_MS,
                'carregar sessão (2ª tentativa)',
              );
            } catch (e2) {
              error = e2;
            }
          }
        }

        const errMsg = String((error as { message?: string })?.message || error || '');
        if (
          errMsg.includes('Tempo esgotado') ||
          errMsg.includes('stole') ||
          errMsg.includes('Lock broken')
        ) {
          try {
            const stored = readCurrentUserFromProfileStore();
            if (stored) {
              if (import.meta.env?.DEV && typeof console !== 'undefined') {
                observabilityConsole.warn('[Auth] getCurrentUser: timeout ou lock de sessão — usando perfil em cache');
              }
              return JSON.parse(stored) as User;
            }
          } catch {
            // ignora
          }
          if (errMsg.includes('Tempo esgotado')) {
            // SELECT do perfil pode estourar 30s; sessão JWT costuma estar ok — evita ficar sem usuário.
            try {
              const { data: sd } = await auth.getSession();
              const sud = sd?.session?.user;
              if (sud) {
                const minimal = await this.buildMinimalAppUserFromAuthUser(sud);
                persistCurrentUserToProfileStore(minimal);
                if (import.meta.env?.DEV && typeof console !== 'undefined') {
                  observabilityConsole.info(
                    '[Auth] getCurrentUser: carga completa esgotou o tempo — sessão válida; usando perfil mínimo até o próximo refresh.',
                  );
                }
                return minimal;
              }
            } catch {
              // segue para o aviso
            }
            if (typeof console !== 'undefined') {
              observabilityConsole.warn(
                '[Auth] getCurrentUser: tempo esgotado após 2 tentativas; sem perfil em cache (rede lenta ou Supabase a iniciar).',
              );
            }
            return null;
          }
        }
        const err = error as { message?: string } | undefined;
        if (err?.message?.includes('Refresh Token') || err?.message?.includes('Auth session missing')) {
          try {
            await auth.signOut();
          } catch {
            // Ignorar erros ao limpar sessão
          }
          return null;
        }
        if (error !== undefined) {
          observabilityConsole.error('Erro ao obter usuário atual:', error);
        }
        return null;
      } finally {
        if (this._getCurrentUserInflight === p) {
          this._getCurrentUserInflight = null;
        }
      }
    })();
    this._getCurrentUserInflight = p;
    return p;
  }

  /** Implementação interna de getCurrentUser (sem timeout). */
  private async getCurrentUserResolved(): Promise<User | null> {
    if (isLocalApiMode()) {
      const me = await fetchAuthMe();
      if (me) {
        persistCurrentUserToProfileStore(me);
        return me;
      }
      try {
        clearCurrentUserFromAllStorages();
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('current_user_changed'));
      } catch {
        // ignora
      }
      return null;
    }

    // Verificar se Supabase está configurado antes de tentar (usando verificação dinâmica)
    if (!checkSupabaseConfigured()) {
      const me = await fetchAuthMe();
      if (me) {
        persistCurrentUserToProfileStore(me);
        return me;
      }
      try {
        const stored = readCurrentUserFromProfileStore();
        if (stored) return JSON.parse(stored) as User;
      } catch {
        // ignora
      }
      return null;
    }

    if (!this.isOnline()) {
      const local = await getLocalSession();
      if (local) {
        const localUser = mapLocalSessionToUser(local);
        persistCurrentUserToProfileStore(localUser);
        return localUser;
      }
      const cached = readCurrentUserFromProfileStore();
      if (cached) {
        return JSON.parse(cached) as User;
      }
      return null;
    }

    let session: any = null;
    try {
      auditSessionRequestStart('getCurrentUser_getSession');
      try {
        const { data: sessionData } = await auth.getSession();
        session = sessionData?.session ?? null;
      } finally {
        auditSessionRequestEnd('getCurrentUser_getSession');
      }
    } catch (error) {
      // Rede/DNS instável: não forçar logout; devolve cache quando possível.
      if (this.isNetworkLikeError(error)) {
        try {
          const cached = readCurrentUserFromProfileStore();
          if (cached) return JSON.parse(cached) as User;
        } catch {
          // ignore
        }
        return null;
      }
      throw error;
    }

    if (!session?.user && this.isOnline()) {
      const refreshed = await this.safeRefreshSession();
      if (refreshed) {
        try {
          const { data: sessionData } = await auth.getSession();
          session = sessionData?.session ?? null;
        } catch {
          // segue sem sessão
        }
      }
    }
    if (!session?.user) {
      try {
        clearCurrentUserFromAllStorages();
        window.dispatchEvent(new Event('current_user_changed'));
      } catch {
        // ignora
      }
      return null;
    }

    const supabaseUser = session.user;
    const tenantCacheKey = this.extractTenantHintSync(supabaseUser) || '_';
    const memHit = getCachedAuthProfile(supabaseUser.id, tenantCacheKey);
    if (memHit) {
      persistCurrentUserToProfileStore(memHit);
      return memHit;
    }

    try {
      const appUser = await this.supabaseUserToAppUser(supabaseUser);
      if (appUser) {
        persistCurrentUserToProfileStore(appUser);
        await saveLocalSession(mapUserToLocalSession(appUser));
        setCachedAuthProfile(
          appUser.id,
          resolveTenantId(appUser) || appUser.companyId || tenantCacheKey,
          appUser,
        );
        return appUser;
      }
    } catch (error: any) {
      if (error?.message?.includes('Refresh Token') || error?.message?.includes('Auth session missing')) {
        try {
          await auth.signOut();
        } catch {
          // Ignorar erros ao limpar sessão
        }
        return null;
      }
      // Perfil completo falhou (RLS/rede): segue com usuário mínimo — não deslogar
    }

    const minimal = await this.buildMinimalAppUserFromAuthUser(supabaseUser);
    persistCurrentUserToProfileStore(minimal);
    await saveLocalSession(mapUserToLocalSession(minimal));
    setCachedAuthProfile(
      minimal.id,
      resolveTenantId(minimal) || minimal.companyId || tenantCacheKey,
      minimal,
    );
    return minimal;
  }

  /** Evita logout na UI quando getSession volta atrasado com sessão válida (corrida com SIGNED_OUT pré-login). */
  private async tryRecoverAppUserFromCurrentSession(): Promise<User | null> {
    try {
      const { data } = await auth.getSession();
      const su = data.session?.user;
      if (!su) return null;
      try {
        const u = await this.supabaseUserToAppUser(su);
        if (u) return u;
      } catch {
        // segue fallback mínimo
      }
      return await this.buildMinimalAppUserFromAuthUser(su);
    } catch {
      return null;
    }
  }

  /**
   * Observar mudanças no estado de autenticação.
   * Em erro ao converter sessão (ex.: timeout no DB), limpa e chama callback(null) para evitar estado inconsistente e loop.
   */
  onAuthStateChanged(callback: (user: User | null) => void): () => void {
    const { data } = auth.onAuthStateChange(async (event, session) => {
        if (import.meta.env?.DEV && typeof console !== 'undefined') {
        const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
        const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
        const isWebView =
          /\bwv\b|WebView|(iPhone|iPod|iPad)(?!.*Safari\/)|Android.*Version\/[\d.]+/i.test(ua);
        const basePayload = {
          timestamp: new Date().toISOString(),
          event,
          hasSession: Boolean(session?.user),
          route: typeof window !== 'undefined' ? window.location.pathname : '',
          visibilityState: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
          online: typeof navigator === 'undefined' ? true : navigator.onLine,
          isMobile,
          isWebView,
        };
        observabilityConsole.info('[AUTH LISTENER EVENT]', basePayload);
        if (event === 'SIGNED_IN') observabilityConsole.info('[AUTH LISTENER SIGNED_IN]', basePayload);
        if (event === 'TOKEN_REFRESHED') observabilityConsole.info('[AUTH LISTENER TOKEN_REFRESHED]', basePayload);
        if (event === 'INITIAL_SESSION') observabilityConsole.info('[AUTH LISTENER INITIAL_SESSION]', basePayload);
      }
      /**
       * Durante o logout, ignorar qualquer evento do listener para evitar o loop:
       * signOut → SIGNED_OUT → listener tenta recuperar sessão → re-loga o usuário.
       * A flag _isSigningOut é liberada 500ms após o signOut concluir.
       */
      if (this._isSigningOut) {
        return;
      }

      /**
       * LOGIN FLOW (owned): submit já autentica, hidrata e navega — o listener não é dono do SIGNED_IN manual.
       */
      if (event === 'SIGNED_IN' && this._manualLoginPipelineId != null) {
        if (import.meta.env?.DEV && typeof console !== 'undefined') {
          observabilityConsole.info('[AUTH PASSIVE OBSERVER]', {
            action: 'skip_signed_in_manual_login_owned',
            pipelineToken: this._manualLoginPipelineId,
          });
        }
        return;
      }

      /**
       * `signInWithEmail` chama `signOut({ local })` antes do `signInWithPassword`. Esse `SIGNED_OUT` não deve
       * disparar dezenas de `getSession()` — o cliente Supabase usa fila única (lock interno): isso empata o
       * próprio login em localhost ou faz o pedido falhar por timeout.
       */
      if (event === 'SIGNED_OUT' && !session?.user && this._passwordSignInActive) {
        if (import.meta.env.DEV && typeof console !== 'undefined') {
          observabilityConsole.log(
            '[AUTH EVENT] SIGNED_OUT — ignorado (signOut local pré-login; não bloquear fila auth) [OK]',
          );
        }
        return;
      }

      const isLikelyLocalhost =
        typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

      /**
       * GoTrue (especialmente com Vite HMR) pode emitir `INITIAL_SESSION null` seguido de `SIGNED_OUT null`
       * sem haver utilizador nem tokens em storage — não é logout real; só duplica clears e corrida com getSession().
       * Caso login em curso usa o bypass imediato acima (`_passwordSignInActive`).
       */
      if (
        event === 'SIGNED_OUT' &&
        !session?.user &&
        !this._passwordSignInActive &&
        !hasSbAuthKeysInBrowser()
      ) {
        if (import.meta.env.DEV && typeof console !== 'undefined') {
          observabilityConsole.log(
            '[AUTH EVENT] SIGNED_OUT null — eco cold start, ignorado (sem chaves sb-* no storage) [OK]',
          );
        }
        return;
      }

      if (import.meta.env.DEV && typeof console !== 'undefined') {
        if (event === 'INITIAL_SESSION' && !session?.user) {
          const sbOrfa = hasSbAuthKeysInBrowser();
          observabilityConsole.log(
            sbOrfa
              ? '[AUTH EVENT] INITIAL_SESSION — sem JWT válido mas há chaves sb-* (tokens antigos/corruptos; serão limpos se getSession continuar vazio) [AVISO]'
              : '[AUTH EVENT] INITIAL_SESSION null — sem sessão guardada (normal antes de fazer login) [OK]',
          );
        } else {
          const detail = session?.user
            ? { userId: session.user.id, expires_at: session.expires_at }
            : hasSbAuthKeysInBrowser()
              ? 'payload sem user · há sb-* no storage (revalidando / possível token órfão)'
              : 'payload sem user';
          observabilityConsole.log('[AUTH EVENT]', event, detail);
        }
      }

      /**
       * Corrida comum no login: `clearLocalAuthSession()` chama signOut e o listener pode receber
       * `session === null` *depois* do signIn já ter concluído — isso apagava o usuário na UI.
       * Se o storage ainda tiver sessão válida, recuperamos antes de deslogar.
       * IMPORTANTE: só faz isso fora do fluxo de logout (flag acima já garante isso).
       */
      let sess = session;
      // Revalidar storage quando vier sem usuário. Em `SIGNED_OUT` após signOut local (troca de conta/login),
      // a nova sessão pode ainda não estar escrita quando o handler roda — getSession pode falhar uma vez só.
      if (!sess?.user) {
        const loginBoost = this._passwordSignInActive;
        let attempts = 1;
        let gapMs = 0;
        if (loginBoost) {
          attempts = 32;
          gapMs = 70;
          /** Localhost: margem extra sem alongar demais — handler lento aumenta corrida com SIGNED_IN */
          if (isLikelyLocalhost) {
            attempts = 40;
            gapMs = 72;
          }
        } else if (event === 'SIGNED_OUT') {
          attempts = 18;
          gapMs = 75;
          if (isLikelyLocalhost) {
            attempts = Math.max(attempts, 28);
            gapMs = Math.max(gapMs, 72);
          }
        } else if (event === 'INITIAL_SESSION') {
          /** GoTrue pode emitir INITIAL_SESSION antes do storage estar hidratado (IndexedDB/WebView; Safari/mobile). */
          attempts = isLikelyLocalhost ? 28 : 20;
          gapMs = isLikelyLocalhost ? 72 : 65;
        } else {
          attempts = 10;
          gapMs = 55;
        }
        for (let i = 0; i < attempts && !sess?.user; i++) {
          if (i > 0) {
            await new Promise((r) => setTimeout(r, gapMs));
          }
          try {
            const { data } = await auth.getSession();
            if (data.session?.user) {
              sess = data.session;
              break;
            }
          } catch {
            // ignora
          }
        }
      }

      /**
       * SIGNED_OUT do signOut local antes do signIn pode demorar a processar; SIGNED_IN pode já ter corrido.
       * Última leitura evita `callback(null)` fantasma após login bem-sucedido.
       */
      if (!sess?.user) {
        try {
          const { data: rebound } = await auth.getSession();
          if (rebound.session?.user) {
            sess = rebound.session;
          }
        } catch {
          // ignora
        }
      }

      try {
        if (sess?.user) {
          // Refresh de token: usa cache do perfil quando possível; senão recarrega (evita return vazio).
          if (event === 'TOKEN_REFRESHED') {
            try {
              const raw = readCurrentUserFromProfileStore();
              if (raw) {
                const cached = JSON.parse(raw) as User;
                if (cached?.id === sess.user.id) {
                  callback(cached);
                  return;
                }
              }
            } catch {
              // segue com carga normal
            }
          }

          let appUser: User | null = null;
          try {
            appUser = await this.supabaseUserToAppUser(sess.user);
          } catch {
            appUser = null;
          }
          if (!appUser) {
            appUser = await this.buildMinimalAppUserFromAuthUser(sess.user);
          }
          persistCurrentUserToProfileStore(appUser!);
          callback(appUser);
        } else {
          const recovered = await this.tryRecoverAppUserFromCurrentSession();
          if (recovered) {
            persistCurrentUserToProfileStore(recovered);
            callback(recovered);
            return;
          }
          /**
           * Chaves `sb-*` sem sessão JWT restabelecível — típico em dev (projeto/URL trocado, refresh parcial, HMR).
           * Sem limpar isto o GoTrue pode manter estado inconsistente e o login falha em localhost.
           */
          if (
            hasSbAuthKeysInBrowser() &&
            !this._passwordSignInActive &&
            !this._isSigningOut
          ) {
            if (import.meta.env.DEV && typeof console !== 'undefined') {
              observabilityConsole.warn(
                '[AUTH] Removendo tokens sb-* locais órfãos (getSession continuou sem utilizador válido).',
              );
            }
            try {
              await clearLocalAuthSession();
            } catch {
              /* ignora */
            }
            const recoveredAfterSweep = await this.tryRecoverAppUserFromCurrentSession();
            if (recoveredAfterSweep) {
              persistCurrentUserToProfileStore(recoveredAfterSweep);
              callback(recoveredAfterSweep);
              return;
            }
          }
          try {
            clearCurrentUserFromAllStorages();
            window.dispatchEvent(new Event('current_user_changed'));
          } catch {
            // ignora
          }
          callback(null);
        }
      } catch (err) {
        if (sess?.user) {
          try {
            const appUser = await this.buildMinimalAppUserFromAuthUser(sess.user);
            persistCurrentUserToProfileStore(appUser);
            callback(appUser);
          } catch {
            try {
              clearCurrentUserFromAllStorages();
              window.dispatchEvent(new Event('current_user_changed'));
            } catch {
              // ignora
            }
            callback(null);
          }
        } else {
          const recoveredOut = await this.tryRecoverAppUserFromCurrentSession();
          if (recoveredOut) {
            persistCurrentUserToProfileStore(recoveredOut);
            callback(recoveredOut);
          } else if (
            hasSbAuthKeysInBrowser() &&
            !this._passwordSignInActive &&
            !this._isSigningOut
          ) {
            try {
              await clearLocalAuthSession();
            } catch {
              /* ignora */
            }
            const swept = await this.tryRecoverAppUserFromCurrentSession();
            if (swept) {
              persistCurrentUserToProfileStore(swept);
              callback(swept);
            } else {
              try {
                clearCurrentUserFromAllStorages();
                window.dispatchEvent(new Event('current_user_changed'));
              } catch {
                // ignora
              }
              callback(null);
            }
          } else {
            try {
              clearCurrentUserFromAllStorages();
              window.dispatchEvent(new Event('current_user_changed'));
            } catch {
              // ignora
            }
            callback(null);
          }
        }
      }
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }
}

export const authService = new AuthService();

/** Chame após trocar o tenant do usuário no mesmo fluxo (ex.: vínculo à empresa), se precisar forçar novo sync. */
export function clearTenantMetadataSyncCache(): void {
  try {
    if (typeof window !== 'undefined') window.sessionStorage.removeItem(TENANT_META_SYNC_KEY);
  } catch {
    // ignora
  }
}
