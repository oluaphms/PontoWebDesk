/**
 * Authentication Service
 * 
 * Gerencia autenticação de usuários usando Supabase Auth
 */

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
              avatar: u.avatar || newUser.avatar,
              preferences: u.preferences || newUser.preferences
            };
          }
        }
        throw insertError;
      }

      return newUser;
    } catch (error) {
      console.error('Erro ao converter usuário Supabase:', error);
      return null;
    }
  }

  /**
   * Login com email e senha
   */
  async signInWithEmail(email: string, password: string): Promise<AuthResult> {
    try {
      const data = await auth.signIn(email, password);
      
      if (!data || !data.user) {
        return { user: null, error: 'Erro ao fazer login. Tente novamente.' };
      }
      
      if (data.user) {
        const appUser = await this.supabaseUserToAppUser(data.user);
        
        if (appUser) {
          // Salvar no localStorage como fallback
          localStorage.setItem('current_user', JSON.stringify(appUser));
          return { user: appUser, error: null };
        }
      }
      
      return { user: null, error: 'Erro ao carregar dados do usuário' };
    } catch (error: any) {
      let errorMessage = 'Erro ao fazer login';
      
      if (error.message) {
        if (error.message.includes('Invalid login credentials')) {
          errorMessage = 'Email ou senha incorretos';
        } else if (error.message.includes('Email not confirmed')) {
          errorMessage = 'Por favor, confirme seu email antes de fazer login';
        } else {
          errorMessage = error.message;
        }
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

  /** URL base para redirect de recuperação (env ou origin). */
  private getResetRedirectUrl(): string {
    const base = (import.meta.env?.VITE_APP_URL || import.meta.env?.VITE_SUPABASE_REDIRECT || '').toString().trim();
    if (base) return base.replace(/\/$/, '');
    if (typeof window !== 'undefined' && window.location?.origin) return String(window.location.origin).replace(/\/$/, '');
    return 'http://localhost:3010';
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
