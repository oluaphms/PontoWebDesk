/**
 * Authentication Service
 * 
 * Gerencia autenticação de usuários usando Supabase Auth
 */

import { auth, db } from './supabase';
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
      // Buscar dados do usuário no banco de dados
      const userData = await db.select('users', [
        { column: 'id', operator: 'eq', value: supabaseUser.id }
      ]);
      
      if (userData && userData.length > 0) {
        const user = userData[0];
        return {
          id: supabaseUser.id,
          nome: user.nome || supabaseUser.user_metadata?.nome || supabaseUser.email?.split('@')[0] || 'Usuário',
          email: supabaseUser.email || '',
          cargo: user.cargo || 'Colaborador',
          role: user.role || 'employee',
          createdAt: user.created_at ? new Date(user.created_at) : new Date(),
          companyId: user.company_id || '',
          departmentId: user.department_id || '',
          avatar: supabaseUser.user_metadata?.avatar_url || user.avatar,
          preferences: user.preferences || {
            notifications: true,
            theme: 'light',
            allowManualPunch: true
          }
        };
      } else {
        // Criar usuário básico se não existir no banco
        const newUser: User = {
          id: supabaseUser.id,
          nome: supabaseUser.user_metadata?.nome || supabaseUser.email?.split('@')[0] || 'Usuário',
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
            allowManualPunch: true
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
        
        return newUser;
      }
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
      const { data, error } = await auth.signIn(email, password);
      
      if (error) throw error;
      
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
      const { data, error } = await auth.signUp(email, password, {
        nome,
        company_id: companyId
      });
      
      if (error) throw error;
      
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
            allowManualPunch: true
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
      const { data, error } = await auth.signInWithOAuth('google');
      
      if (error) throw error;
      
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
   * Recuperação de senha
   */
  async resetPassword(email: string): Promise<{ success: boolean; error: string | null }> {
    try {
      await auth.resetPassword(email);
      return { success: true, error: null };
    } catch (error: any) {
      let errorMessage = 'Erro ao enviar email de recuperação';
      
      if (error.message) {
        if (error.message.includes('not found')) {
          errorMessage = 'Usuário não encontrado';
        } else {
          errorMessage = error.message;
        }
      }
      
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Obter usuário atual
   */
  async getCurrentUser(): Promise<User | null> {
    try {
      const supabaseUser = await auth.getUser();
      
      if (!supabaseUser) {
        // Tentar recuperar do localStorage como fallback
        const saved = localStorage.getItem('current_user');
        if (saved) {
          return JSON.parse(saved);
        }
        return null;
      }
      
      return await this.supabaseUserToAppUser(supabaseUser);
    } catch (error) {
      console.error('Erro ao obter usuário atual:', error);
      // Tentar recuperar do localStorage como fallback
      const saved = localStorage.getItem('current_user');
      if (saved) {
        return JSON.parse(saved);
      }
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
