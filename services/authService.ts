/**
 * Authentication Service
 * 
 * Gerencia autenticação de usuários usando Supabase Auth
 */

import { getAppBaseUrl } from './appUrl';
import { auth, db, isSupabaseConfigured, supabase } from './supabase';
import { User } from '../types';

export interface AuthResult {
  user: User | null;
  error: string | null;
}

class AuthService {
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
        return {
          id: supabaseUser.id,
          nome: user.nome || supabaseUser.user_metadata?.nome || email.split('@')[0] || 'Usuário',
          email: supabaseUser.email || '',
          cargo: user.cargo || 'Colaborador',
          role: user.role || 'employee',
          createdAt: user.created_at ? new Date(user.created_at) : new Date(),
          companyId: user.company_id ?? '',
          departmentId: user.department_id ?? '',
          schedule_id: user.schedule_id,
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
      const newUser: User = {
        id: supabaseUser.id,
        nome: supabaseUser.user_metadata?.nome || email.split('@')[0] || 'Usuário',
        email: supabaseUser.email || '',
        cargo: 'Colaborador',
        role: 'employee',
        createdAt: new Date(),
        companyId: '',
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
            return {
              id: supabaseUser.id,
              nome: u.nome || newUser.nome,
              email: supabaseUser.email || '',
              cargo: u.cargo || 'Colaborador',
              role: u.role || 'employee',
              createdAt: u.created_at ? new Date(u.created_at) : new Date(),
              companyId: u.company_id ?? '',
              departmentId: u.department_id ?? '',
              schedule_id: u.schedule_id,
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
      console.error('Erro ao converter usuário Supabase:', msg);
      // Fallback: retorna usuário mínimo a partir só do Auth (tabela users inexistente/RLS/schema)
      const email = (supabaseUser?.email || '').trim().toLowerCase();
      if (!email) return null;
      return {
        id: supabaseUser.id,
        nome: supabaseUser.user_metadata?.nome || email.split('@')[0] || 'Usuário',
        email: supabaseUser.email || '',
        cargo: 'Colaborador',
        role: 'employee',
        createdAt: new Date(),
        companyId: '',
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
   * Tenta limpar sessão anterior com timeout curto para não travar se o Supabase estiver lento/inacessível.
   */
  async signInWithEmail(email: string, password: string): Promise<AuthResult> {
    try {
      // Limpar sessão local primeiro (instantâneo, não chama servidor) para não travar em estado quebrado após timeout
      await auth.signOut({ scope: 'local' });
      // Tentar também signOut no servidor com timeout; se estiver lento/pausado, não bloqueia
      try {
        await Promise.race([
          auth.signOut(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('signOut timeout')), 2000)),
        ]);
      } catch {
        // Ignora: sessão inexistente, timeout ou servidor inacessível – segue para signIn
      }
      const data = await auth.signIn(email, password);
      
      if (!data || !data.user) {
        return { user: null, error: 'Erro ao fazer login. Tente novamente.' };
      }
      
      if (data.user) {
        // Timeout na carga do perfil: evita "Servidor indisponível" quando só um usuário
        // (ex.: desenvolvedor@smartponto.com) tem perfil lento/RLS travando em public.users
        const PROFILE_LOAD_TIMEOUT_MS = 12000;
        const appUser = await Promise.race([
          this.supabaseUserToAppUser(data.user),
          new Promise<User | null>((resolve) =>
            setTimeout(() => {
              console.warn('[Auth] Carregamento do perfil em public.users excedeu o tempo; usando perfil mínimo.');
              resolve(null);
            }, PROFILE_LOAD_TIMEOUT_MS)
          ),
        ]);
        if (appUser) {
          try {
            localStorage.setItem('current_user', JSON.stringify(appUser));
          } catch {
            // ignore
          }
          return { user: appUser, error: null };
        }
        // Fallback: perfil não carregou a tempo (timeout). Tentar buscar só o role no DB
        // para admin/desenvolvedor não caírem na dashboard de funcionário.
        let fallbackRole: User['role'] = 'employee';
        let fallbackCompanyId = '';
        try {
          const roleRows = await Promise.race([
            db.select('users', [{ column: 'id', operator: 'eq', value: data.user.id }], undefined as any, 1),
            new Promise<any[]>(r => setTimeout(() => r([]), 2000)),
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
          // mantém employee e companyId vazio
        }
        const u = data.user;
        const email = (u.email || '').trim().toLowerCase();
        const minimalUser: User = {
          id: u.id,
          nome: u.user_metadata?.nome || email.split('@')[0] || 'Usuário',
          email: u.email || '',
          cargo: 'Colaborador',
          role: fallbackRole,
          createdAt: new Date(),
          companyId: fallbackCompanyId,
          departmentId: '',
          avatar: u.user_metadata?.avatar_url,
          preferences: { notifications: true, theme: 'light', allowManualPunch: true, language: 'pt-BR' }
        };
        return { user: minimalUser, error: null };
      }
      
      return { user: null, error: 'Erro ao fazer login. Tente novamente.' };
    } catch (error: any) {
      let errorMessage = 'Erro ao fazer login';
      const msg = error?.message ?? '';

      if (msg.includes('Invalid login credentials') || error?.status === 400) {
        errorMessage = 'Email ou senha incorretos. Confira se o usuário existe em Authentication → Users no Supabase.';
      } else if (msg.includes('Email not confirmed')) {
        errorMessage = 'Por favor, confirme seu email antes de fazer login (ou marque Auto Confirm no Supabase).';
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
        
        localStorage.setItem('current_user', JSON.stringify(newUser));
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
   * Logout
   */
  async signOut(): Promise<void> {
    try {
      await auth.signOut();
      localStorage.removeItem('current_user');
    } catch (error) {
      console.error('Erro ao fazer logout:', error);
      throw error;
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
      const { data: { session } } = await supabase.auth.getSession();
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
        const { data: { session: next } } = await supabase.auth.getSession();
        return { session: next ?? null };
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
   * Obter usuário atual
   */
  async getCurrentUser(): Promise<User | null> {
    try {
      // Verificar se Supabase está configurado antes de tentar
      if (!isSupabaseConfigured) {
        console.warn('Supabase not configured - returning null user');
        return null;
      }

      // Timeout de segurança para evitar travamento
      const getUserPromise = auth.getUser();
      const timeoutPromise = new Promise<any>((resolve) => {
        setTimeout(() => resolve(null), 3000);
      });
      
      const supabaseUser = await Promise.race([getUserPromise, timeoutPromise]);
      
      if (!supabaseUser) {
        return null;
      }
      
      return await this.supabaseUserToAppUser(supabaseUser);
    } catch (error: any) {
      // Tratar erros de refresh token inválido silenciosamente (comportamento esperado quando não há sessão)
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

  /**
   * Observar mudanças no estado de autenticação
   */
  onAuthStateChanged(callback: (user: User | null) => void) {
    return auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        const appUser = await this.supabaseUserToAppUser(session.user);
        callback(appUser);
      } else {
        callback(null);
      }
    });
  }
}

export const authService = new AuthService();
