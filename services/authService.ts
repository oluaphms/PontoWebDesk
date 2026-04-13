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
  getUserProfileStorage,
  isSupabaseConfigured,
  checkSupabaseConfigured,
  supabase,
  DB_SELECT_TIMEOUT_MS,
} from './supabaseClient';
import { clearLocalAuthSession } from './supabase';
import { withTimeout } from '../src/utils/withTimeout';
import { User } from '../types';
import { logTenantLoginSuccess } from '../src/services/tenantAudit';
import { resolveTenantId } from '../src/services/tenantScope';

export interface AuthResult {
  user: User | null;
  error: string | null;
}

/** Evita chamadas repetidas a auth.updateUser (causavam lentidão, refresh em loop e logout falso). */
const TENANT_META_SYNC_KEY = 'sp_tenant_meta_sync';

/** Carregar perfil pode fazer 2× `db.select` em sequência; deve ser > 2× timeout do select para não abortar antes. */
const GET_CURRENT_USER_TIMEOUT_MS = DB_SELECT_TIMEOUT_MS * 2 + 8000;

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

class AuthService {
  /** Previne que o listener onAuthStateChanged tente recuperar sessão durante o logout. */
  private _isSigningOut = false;

  /**
   * Sincroniza tenant_id no user_metadata (JWT) — só chama API se ainda não estiver no token/cache.
   * Evita updateUser repetido (principal causa de lentidão/instabilidade no login).
   */
  private async syncTenantUserMetadata(
    appUser: User,
    authUser?: { user_metadata?: Record<string, unknown> } | null,
  ): Promise<void> {
    if (!isSupabaseConfigured || !supabase) return;
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

  /** Após login: sync de metadata sem bloquear a UI (idle / próximo tick). */
  private enqueuePostLoginSideEffects(appUser: User, authUser: { user_metadata?: Record<string, unknown> } | null): void {
    const run = () => {
      void this.syncTenantUserMetadata(appUser, authUser).catch(() => {});
      void logTenantLoginSuccess(appUser).catch(() => {});
    };
    if (typeof window === 'undefined') {
      void run();
      return;
    }
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(() => run(), { timeout: 3000 });
    } else {
      window.setTimeout(run, 0);
    }
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

    // Se for o usuário informando "nome"/"primeiro nome" (sem @),
    // o app ainda NÃO tem sessão auth; então RLS costuma bloquear leitura de public.users.
    // Para funcionar sempre, chamamos uma RPC SECURITY DEFINER que ignora RLS e resolve para o email.
    let attemptedRpc = false;
    if (!lower.includes('@') && isSupabaseConfigured && supabase) {
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
      } catch {
        // ignora e segue com fallback (db.select) para compatibilidade
      }
    }

    // 0) Atalhos comuns: "admin" e "administrador" sempre usam a conta admin padrão
    if (lower === 'admin' || lower === 'administrador') {
      return 'admin@smartponto.com';
    }
    if (lower === 'desenvolvedor' || lower === 'dev') {
      return 'desenvolvedor@smartponto.com';
    }
    if (lower === 'funcionario' || lower === 'funcionário') {
      return 'funcionario@smartponto.com';
    }

    // 1) Já é um email
    if (lower.includes('@')) {
      return lower;
    }

    // Se Supabase não está configurado, mantém o comportamento antigo
    if (!isSupabaseConfigured) {
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
    if (email === 'admin@smartponto.com' || email === 'desenvolvedor@smartponto.com') {
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
   * Converte Supabase User para User do sistema
   */
  private async supabaseUserToAppUser(supabaseUser: any): Promise<User | null> {
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
        const user = userData[0];
        const dbRole = (user.role as string)?.toLowerCase();
        let effectiveRole: User['role'] =
          dbRole === 'admin' || dbRole === 'hr' || dbRole === 'supervisor'
            ? (user.role as User['role'])
            : ((user.role as User['role']) || 'employee');
        const emailLower = email.toLowerCase();
        if (
          emailLower === 'admin@smartponto.com' ||
          emailLower === 'desenvolvedor@smartponto.com'
        ) {
          effectiveRole = 'admin';
        }
        if (emailLower === 'funcionario@smartponto.com') {
          effectiveRole = 'employee';
        }
        const cid = user.company_id ?? '';
        const tid = (user as { tenant_id?: string }).tenant_id ?? cid;
        return {
          id: supabaseUser.id,
          nome: user.nome || supabaseUser.user_metadata?.nome || email.split('@')[0] || 'Usuário',
          email: supabaseUser.email || '',
          cargo: user.cargo || 'Colaborador',
          role: effectiveRole,
          createdAt: user.created_at ? new Date(user.created_at) : new Date(),
          companyId: cid,
          tenantId: tid,
          departmentId: user.department_id ?? '',
          schedule_id: user.schedule_id,
          shift_id: (user as { shift_id?: string }).shift_id,
          phone: user.phone,
          avatar: supabaseUser.user_metadata?.avatar_url || user.avatar,
          preferences: user.preferences || {
            notifications: true,
            theme: 'light',
            allowManualPunch: true
          }
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
      if (emailLower === 'admin@smartponto.com' || emailLower === 'desenvolvedor@smartponto.com') {
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
            const u = byEmail[0];
            const cid = u.company_id ?? '';
            const tid = (u as { tenant_id?: string }).tenant_id ?? cid;
            return {
              id: supabaseUser.id,
              nome: u.nome || newUser.nome,
              email: supabaseUser.email || '',
              cargo: u.cargo || 'Colaborador',
              role: u.role || 'employee',
              createdAt: u.created_at ? new Date(u.created_at) : new Date(),
              companyId: cid,
              tenantId: tid,
              departmentId: u.department_id ?? '',
              schedule_id: u.schedule_id,
              shift_id: (u as { shift_id?: string }).shift_id,
              phone: u.phone,
              avatar: u.avatar || newUser.avatar,
              preferences: u.preferences || newUser.preferences
            };
          }
        }
        throw insertError;
      }

      return newUser;
    } catch (error: any) {
      const msg = error?.message ?? error?.code ?? String(error);
      const isTimeout =
        typeof msg === 'string' &&
        (msg.includes('Tempo esgotado ao carregar dados') ||
          msg.includes('Supabase timeout') ||
          msg.includes('stole') ||
          msg.includes('Lock broken') ||
          /timeout/i.test(msg));
      if (isTimeout) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn(
            '[Auth] Perfil em public.users demorou ou indisponível; usando dados mínimos do Auth. Próxima sincronização pode preencher empresa e permissões.',
          );
        }
      } else {
        console.error('Erro ao converter usuário Supabase:', msg);
      }
      if (typeof msg === 'string' && (msg.includes('infinite recursion') || msg.includes('policy for relation'))) {
        console.warn('[Supabase RLS] Recursão nas políticas detectada. No Supabase (SQL Editor), execute a migration 20250329000000_fix_rls_users_recursion_definitive.sql. Veja INSTRUCOES_IMPORTACAO_FUNCIONARIOS.md §9.');
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
      if (emailLower === 'admin@smartponto.com' || emailLower === 'desenvolvedor@smartponto.com') {
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
   * Não faz signOut antes do signIn para evitar loop e falha no segundo login (sessão é substituída pelo Supabase).
   */
  async signInWithEmail(identifier: string, password: string): Promise<AuthResult> {
    let resolvedEmail = '';
    const isEmailInput = (identifier || '').trim().includes('@');
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

      const data = await auth.signIn(resolvedEmail, password);

      if (!data || !data.user) {
        return { user: null, error: 'Erro ao fazer login. Tente novamente.' };
      }

      if (data.user) {
        // Timeout na carga do perfil: free tier / RLS podem demorar; fallback evita travar o login
        const PROFILE_LOAD_TIMEOUT_MS = 20000;
        const appUser = await Promise.race([
          this.supabaseUserToAppUser(data.user),
          new Promise<User | null>((resolve) =>
            setTimeout(() => {
              if (import.meta.env?.DEV && typeof console !== 'undefined') {
                console.info('[Auth] Perfil completo ainda carregando; usando perfil mínimo. Você pode seguir usando o sistema.');
              }
              resolve(null);
            }, PROFILE_LOAD_TIMEOUT_MS)
          ),
        ]);
        if (appUser) {
          persistCurrentUserToProfileStore(appUser);
          this.enqueuePostLoginSideEffects(appUser, data.user);
          return { user: appUser, error: null };
        }
        // Fallback: perfil não carregou a tempo (timeout) — mesmo fluxo que onAuthStateChanged (não deslogar)
        const minimalUser = await this.buildMinimalAppUserFromAuthUser(data.user);
        persistCurrentUserToProfileStore(minimalUser);
        this.enqueuePostLoginSideEffects(minimalUser, data.user);
        return { user: minimalUser, error: null };
      }

      return { user: null, error: 'Erro ao fazer login. Tente novamente.' };
    } catch (error: any) {
      let errorMessage = 'Erro ao fazer login';
      const msg = error?.message ?? '';

      if (msg.includes('Invalid login credentials') || error?.status === 400) {
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

      return { user: null, error: errorMessage };
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
    // Sinaliza para o listener onAuthStateChanged ignorar eventos de sessão nula durante o logout.
    this._isSigningOut = true;
    try {
      // 1) Derruba a sessão local imediatamente (instantâneo).
      // Isso evita ficar preso num estado “meio logado” no PWA.
      await clearLocalAuthSession();

      // 2) Tenta invalidar sessão no servidor também (quando houver rede).
      // `global` faz logout mais robusto em cenários com múltiplos dispositivos/sessões.
      await auth.signOut({ scope: 'global' });
    } catch (error) {
      if (import.meta.env?.DEV && typeof console !== 'undefined') {
        console.warn('[Auth] signOut falhou (seguindo com limpeza local):', error);
      } else {
        console.error('Erro ao fazer logout:', error);
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
          console.info('[Auth] Logout concluído em', Date.now() - startedAt, 'ms');
        }
      }
    }
  }

  /**
   * Alterar senha do usuário atual
   */
  async updatePassword(newPassword: string): Promise<void> {
    try {
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
    try {
      const redirectTo = `${this.getResetRedirectUrl()}/reset-password`;
      await auth.resetPassword(email, redirectTo);
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
    if (!isSupabaseConfigured) return null;
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
    if (!isSupabaseConfigured || !supabase) return { session: null };
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
    try {
      return await withTimeout(this.getCurrentUserResolved(), GET_CURRENT_USER_TIMEOUT_MS, 'carregar sessão');
    } catch (error: any) {
      const errMsg = String(error?.message || '');
      if (
        errMsg.includes('Tempo esgotado') ||
        errMsg.includes('stole') ||
        errMsg.includes('Lock broken')
      ) {
        try {
          const stored = readCurrentUserFromProfileStore();
          if (stored) {
            if (import.meta.env?.DEV && typeof console !== 'undefined') {
              console.warn('[Auth] getCurrentUser: timeout ou lock de sessão — usando perfil em cache');
            }
            return JSON.parse(stored) as User;
          }
        } catch {
          // ignora
        }
      }
      if (error?.message?.includes('Refresh Token') || error?.message?.includes('Auth session missing')) {
        try {
          await auth.signOut();
        } catch {
          // Ignorar erros ao limpar sessão
        }
        return null;
      }
      console.error('Erro ao obter usuário atual:', error);
      return null;
    }
  }

  /** Implementação interna de getCurrentUser (sem timeout). */
  private async getCurrentUserResolved(): Promise<User | null> {
    // Verificar se Supabase está configurado antes de tentar (usando verificação dinâmica)
    if (!checkSupabaseConfigured()) {
      console.warn('Supabase not configured - returning null user');
      try {
        const stored = readCurrentUserFromProfileStore();
        if (stored) {
          return JSON.parse(stored) as User;
        }
      } catch {
        // ignora erro de leitura
      }
      return null;
    }

    const { data: sessionData } = await auth.getSession();
    const session = sessionData?.session ?? null;
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

    try {
      const appUser = await this.supabaseUserToAppUser(supabaseUser);
      if (appUser) {
        persistCurrentUserToProfileStore(appUser);
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
    return minimal;
  }

  /**
   * Observar mudanças no estado de autenticação.
   * Em erro ao converter sessão (ex.: timeout no DB), limpa e chama callback(null) para evitar estado inconsistente e loop.
   */
  onAuthStateChanged(callback: (user: User | null) => void) {
    return auth.onAuthStateChange(async (event, session) => {
      /**
       * Durante o logout, ignorar qualquer evento do listener para evitar o loop:
       * signOut → SIGNED_OUT → listener tenta recuperar sessão → re-loga o usuário.
       * A flag _isSigningOut é liberada 500ms após o signOut concluir.
       */
      if (this._isSigningOut) {
        return;
      }

      /**
       * Corrida comum no login: `clearLocalAuthSession()` chama signOut e o listener pode receber
       * `session === null` *depois* do signIn já ter concluído — isso apagava o usuário na UI.
       * Se o storage ainda tiver sessão válida, recuperamos antes de deslogar.
       * IMPORTANTE: só faz isso fora do fluxo de logout (flag acima já garante isso).
       */
      let sess = session;
      if (!sess?.user && event !== 'SIGNED_OUT') {
        try {
          const { data } = await auth.getSession();
          if (data.session?.user) {
            sess = data.session;
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
          try {
            clearCurrentUserFromAllStorages();
            window.dispatchEvent(new Event('current_user_changed'));
          } catch {
            // ignora
          }
          callback(null);
        }
      }
    });
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
