import { useEffect, useState, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../services/supabaseClient';

export interface User {
  id: string;
  email?: string;
  nome?: string;
  role: 'admin' | 'hr' | 'employee';
  company_id?: string;
  department_id?: string;
}

// Cache simples em memória
let cachedUser: User | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

/**
 * Lê o usuário do cache (usado por componentes que não precisam de reatividade)
 */
export function readCachedUser(): User | null {
  if (cachedUser && Date.now() - cacheTimestamp < CACHE_DURATION) {
    return cachedUser;
  }
  return null;
}

/**
 * Hook para obter o usuário atual com reatividade
 */
export function useCurrentUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    if (!isSupabaseConfigured) {
      console.log('[useCurrentUser] Supabase não configurado');
      setLoading(false);
      return;
    }

    try {
      console.log('[useCurrentUser] Buscando sessão...');
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (error) {
        console.error('[useCurrentUser] Erro ao buscar sessão:', error);
        setUser(null);
        cachedUser = null;
        setLoading(false);
        return;
      }
      
      if (!session?.user) {
        console.log('[useCurrentUser] Sem sessão ativa');
        setUser(null);
        cachedUser = null;
        setLoading(false);
        return;
      }

      console.log('[useCurrentUser] Usuário autenticado:', session.user.id);
      
      // Busca o perfil do usuário
      const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('*')
        .eq('id', session.user.id)
        .single();

      if (profileError) {
        console.error('[useCurrentUser] Erro ao buscar perfil:', profileError);
        setUser(null);
        cachedUser = null;
      } else {
        console.log('[useCurrentUser] Perfil carregado:', profile);
        setUser(profile);
        cachedUser = profile;
        cacheTimestamp = Date.now();
      }
    } catch (err) {
      console.error('[useCurrentUser] Erro inesperado:', err);
      setUser(null);
      cachedUser = null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUser();

    if (isSupabaseConfigured) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        console.log('[useCurrentUser] Auth state changed:', _event);
        if (session?.user) {
          loadUser();
        } else {
          setUser(null);
          cachedUser = null;
          setLoading(false);
        }
      });

      return () => subscription.unsubscribe();
    }
  }, [loadUser]);

  return { user, loading, refresh: loadUser };
}

export default useCurrentUser;
