/**
 * ⚠️ AUTH RULE — acesso à sessão fora de componentes React.
 *
 * - Em componentes/páginas: use `useAuth()` (NUNCA localStorage direto).
 * - Em serviços/utilitários sem hooks: use `getAuthUserOutsideReact()` ou `getSessionTenantScope()`.
 * - Única leitura de `current_user` no storage: `authSessionInternals.ts` (via provider).
 */
import type { User } from '../../types';
import { getSessionUserCache, readUserFromProfileStore } from '../contexts/authSessionInternals';

export type SessionTenantScope = {
  companyId: string;
  userId: string;
  role?: string;
};

/** Perfil atual sincronizado com AuthSessionProvider (memória → profile store). */
export function getAuthUserOutsideReact(): User | null {
  return getSessionUserCache() ?? readUserFromProfileStore();
}

/** Escopo tenant para serviços (geo, cache, etc.) sem importar React. */
export function getSessionTenantScope(): SessionTenantScope {
  const user = getAuthUserOutsideReact();
  if (!user) {
    return { companyId: 'no-company', userId: 'no-user' };
  }
  const companyId = String(user.companyId ?? user.tenantId ?? '').trim() || 'no-company';
  return {
    companyId,
    userId: user.id,
    role: user.role,
  };
}
